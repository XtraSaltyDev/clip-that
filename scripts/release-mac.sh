#!/usr/bin/env bash

# Build a production macOS release, require real Developer ID signing, notarize the app
# bundles through electron-builder, then notarize and staple the DMG delivery files too.

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")

release_keychain=""
release_keychain_dir=""
cleanup_release_keychain() {
  if [ -n "$release_keychain" ]; then
    security delete-keychain "$release_keychain" >/dev/null 2>&1 || true
  fi
  if [ -n "$release_keychain_dir" ]; then
    rm -f "$release_keychain_dir/developer-id.p12"
    rmdir "$release_keychain_dir" >/dev/null 2>&1 || true
  fi
}
trap cleanup_release_keychain EXIT

if [ -n "${CSC_LINK:-}" ]; then
  : "${CSC_KEY_PASSWORD:?CSC_KEY_PASSWORD is required when CSC_LINK is set}"

  # electron-builder imports CSC_LINK into a temporary keychain that is removed
  # when its process exits. Keep our own short-lived copy available for the
  # separate delivery-image signing step below.
  release_keychain_dir=$(mktemp -d "${TMPDIR:-/tmp}/clipthat-release-keychain.XXXXXX")
  release_certificate="$release_keychain_dir/developer-id.p12"
  release_keychain="$release_keychain_dir/clipthat-release.keychain-db"
  release_keychain_password=$(openssl rand -hex 24)

  CSC_CERTIFICATE_PATH="$release_certificate" node <<'NODE'
const fs = require('node:fs')
const { fileURLToPath } = require('node:url')

const link = process.env.CSC_LINK
const destination = process.env.CSC_CERTIFICATE_PATH
if (!link || !destination) process.exit(1)

if (link.startsWith('file://')) {
  fs.copyFileSync(fileURLToPath(link), destination)
} else if (fs.existsSync(link)) {
  fs.copyFileSync(link, destination)
} else {
  const encoded = link.startsWith('base64:') ? link.slice('base64:'.length) : link
  fs.writeFileSync(destination, Buffer.from(encoded.replace(/\s/g, ''), 'base64'))
}
NODE

  security create-keychain -p "$release_keychain_password" "$release_keychain"
  security set-keychain-settings -lut 21600 "$release_keychain"
  security unlock-keychain -p "$release_keychain_password" "$release_keychain"
  security import "$release_certificate" -k "$release_keychain" \
    -P "$CSC_KEY_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
    -k "$release_keychain_password" "$release_keychain"
  security list-keychains -d user -s "$release_keychain"
elif ! security find-identity -v -p codesigning 2>/dev/null \
  | grep -q 'Developer ID Application:'; then
  echo "No valid Developer ID Application identity is available in the keychain." >&2
  echo "Install one locally or set CSC_LINK and CSC_KEY_PASSWORD in CI." >&2
  exit 1
fi

notary_args=()
if [ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]; then
  notary_args=(--keychain-profile "$APPLE_KEYCHAIN_PROFILE")
  if [ -n "${APPLE_KEYCHAIN:-}" ]; then
    notary_args+=(--keychain "$APPLE_KEYCHAIN")
  fi
elif [ -n "${APPLE_ID:-}" ] || [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] || [ -n "${APPLE_TEAM_ID:-}" ]; then
  : "${APPLE_ID:?APPLE_ID is required for Apple ID notarization}"
  : "${APPLE_APP_SPECIFIC_PASSWORD:?APPLE_APP_SPECIFIC_PASSWORD is required for Apple ID notarization}"
  : "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required for Apple ID notarization}"
  notary_args=(
    --apple-id "$APPLE_ID"
    --password "$APPLE_APP_SPECIFIC_PASSWORD"
    --team-id "$APPLE_TEAM_ID"
  )
elif [ -n "${APPLE_API_KEY:-}" ] || [ -n "${APPLE_API_KEY_ID:-}" ] || [ -n "${APPLE_API_ISSUER:-}" ]; then
  : "${APPLE_API_KEY:?APPLE_API_KEY is required for API-key notarization}"
  : "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required for API-key notarization}"
  : "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required for API-key notarization}"
  notary_args=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
else
  echo "No notarization credentials are configured." >&2
  echo "Set APPLE_KEYCHAIN_PROFILE, Apple ID credentials, or App Store Connect API-key credentials." >&2
  exit 1
fi

echo "Building, Developer ID signing, and notarizing ClipThat $VERSION for macOS"
npm run build:ffmpeg:mac
npm run build
npx electron-builder --mac --arm64 --publish never -c.forceCodeSigning=true

dmg="dist/ClipThat-$VERSION-arm64.dmg"
zip="dist/ClipThat-$VERSION-arm64-mac.zip"
zip_blockmap="$zip.blockmap"
latest_macos="dist/latest-mac.yml"
source_bundle="dist/ClipThat-$VERSION-third-party-sources.tar.gz"
cp "build/vendor/ffmpeg/ClipThat-third-party-sources.tar.gz" "$source_bundle"
for artifact in "$dmg" "$zip" "$zip_blockmap" "$source_bundle"; do
  if [ ! -f "$artifact" ]; then
    echo "Missing macOS release artifact: $artifact" >&2
    exit 1
  fi
done

signing_identity="${CSC_NAME:-}"
if [ -z "$signing_identity" ]; then
  signing_identity=$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' \
    | head -n 1)
fi
if [ -z "$signing_identity" ]; then
  echo "Cannot find the Developer ID Application identity needed to sign the DMG." >&2
  echo "Install the identity in the keychain or set CSC_NAME." >&2
  exit 1
fi

echo "Developer ID signing delivery image: $dmg"
codesign --force --sign "$signing_identity" --timestamp \
  --identifier dev.clipthat.app.dmg "$dmg"
codesign --verify --verbose=2 "$dmg"

echo "Notarizing delivery image: $dmg"
xcrun notarytool submit "$dmg" "${notary_args[@]}" --wait
xcrun stapler staple "$dmg"

# The DMG is signed after electron-builder creates its metadata. Regenerate the
# channel file from the unchanged, signed-app ZIP so no stale DMG digest is published.
node scripts/prepare-mac-update.mjs create \
  --version "$VERSION" \
  --archive "$zip" \
  --blockmap "$zip_blockmap" \
  --metadata "$latest_macos" \
  --published-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

bash scripts/verify-mac-release.sh

(
  cd dist
  shasum -a 256 \
    "ClipThat-$VERSION-arm64.dmg" \
    "ClipThat-$VERSION-arm64-mac.zip" \
    "ClipThat-$VERSION-arm64-mac.zip.blockmap" \
    "ClipThat-$VERSION-third-party-sources.tar.gz" \
    latest-mac.yml
) > "dist/ClipThat-$VERSION-SHA256SUMS.txt"

echo "Wrote dist/ClipThat-$VERSION-SHA256SUMS.txt"
