#!/usr/bin/env bash

# Build a production macOS release, require real Developer ID signing, notarize the app
# bundles through electron-builder, then notarize and staple the DMG delivery files too.

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")

if ! security find-identity -v -p codesigning 2>/dev/null \
  | grep -q 'Developer ID Application:'; then
  echo "No valid Developer ID Application identity is available in the keychain." >&2
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
npm run build
npx electron-builder --mac --publish never -c.forceCodeSigning=true

shopt -s nullglob
dmgs=(dist/ClipThat-"$VERSION"-*.dmg)
if [ "${#dmgs[@]}" -ne 2 ]; then
  echo "Expected two architecture-specific DMGs for $VERSION; found ${#dmgs[@]}." >&2
  exit 1
fi

for dmg in "${dmgs[@]}"; do
  echo "Notarizing delivery image: $dmg"
  xcrun notarytool submit "$dmg" "${notary_args[@]}" --wait
  xcrun stapler staple "$dmg"
done

bash scripts/verify-mac-release.sh

(
  cd dist
  shasum -a 256 \
    "ClipThat-$VERSION-arm64.dmg" \
    "ClipThat-$VERSION-x64.dmg" \
    "ClipThat-$VERSION-arm64-mac.zip" \
    "ClipThat-$VERSION-mac.zip"
) > "dist/ClipThat-$VERSION-SHA256SUMS.txt"

echo "Wrote dist/ClipThat-$VERSION-SHA256SUMS.txt"
