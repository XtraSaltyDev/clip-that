#!/usr/bin/env bash

# Verify the exact app bundles and delivery artifacts produced for the current version.

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
EXPECTED_TEAM_ID=${APPLE_TEAM_ID:-ZHK3C6Y5R8}
mode=${1:---complete}
if [ "$mode" != "--complete" ] && [ "$mode" != "--delivery-only" ]; then
  echo "Usage: $0 [--complete|--delivery-only]" >&2
  exit 1
fi

dmgs=(dist/ClipThat-"$VERSION"-arm64.dmg)
zips=(dist/ClipThat-"$VERSION"-arm64-mac.zip)
zip_blockmap=dist/ClipThat-"$VERSION"-arm64-mac.zip.blockmap
latest_macos=dist/latest-mac.yml
source_bundle=dist/ClipThat-"$VERSION"-third-party-sources.tar.gz

for artifact in "${dmgs[@]}" "${zips[@]}" "$zip_blockmap" "$latest_macos" "$source_bundle"; do
  if [ ! -f "$artifact" ]; then
    echo "Missing release artifact: $artifact" >&2
    exit 1
  fi
done

verify_source_hash() {
  local member=$1
  local expected=$2
  local actual
  actual=$(tar -xOf "$source_bundle" "./$member" | shasum -a 256 | awk '{print $1}')
  if [[ "$actual" != "$expected" ]]; then
    echo "$source_bundle contains an unexpected $member digest." >&2
    exit 1
  fi
}
verify_source_hash ffmpeg-9.0.1.tar.xz cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635
verify_source_hash libvpx-1.16.0.tar.gz b19c48b6384c5f9352d4c861a9659e3e7041918aad23da63e84559674816adac
verify_source_hash opus-1.6.1.tar.gz 6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1

source_listing=$(tar -tzf "$source_bundle")
for source_file in \
  "ffmpeg-9.0.1.tar.xz" \
  "libvpx-1.16.0.tar.gz" \
  "opus-1.6.1.tar.gz" \
  "BUILD-FFMPEG.txt"; do
  grep -q "${source_file}$" <<<"$source_listing" || {
    echo "$source_bundle does not contain $source_file." >&2
    exit 1
  }
done

node scripts/prepare-mac-update.mjs verify \
  --version "$VERSION" \
  --archive "${zips[0]}" \
  --blockmap "$zip_blockmap" \
  --metadata "$latest_macos"

if [ "$mode" = "--complete" ]; then
  app_path=dist/mac-arm64/ClipThat.app
  if [ ! -d "$app_path" ]; then
    echo "Missing packaged app: $app_path" >&2
    exit 1
  fi

  codesign --verify --deep --strict --verbose=2 "$app_path"

  details=$(codesign -dvvv "$app_path" 2>&1)
  grep -q 'Authority=Developer ID Application:' <<<"$details"
  grep -q "TeamIdentifier=$EXPECTED_TEAM_ID" <<<"$details"
  grep -q 'flags=0x10000(runtime)' <<<"$details"

  actual_version=$(defaults read "$PWD/$app_path/Contents/Info.plist" CFBundleShortVersionString)
  if [ "$actual_version" != "$VERSION" ]; then
    echo "$app_path has version $actual_version; expected $VERSION." >&2
    exit 1
  fi

  spctl --assess --type execute --verbose=2 "$app_path"
  xcrun stapler validate "$app_path"
fi

for dmg in "${dmgs[@]}"; do
  hdiutil verify "$dmg"
  codesign --verify --strict --verbose=2 "$dmg"
  dmg_details=$(codesign -dvvv "$dmg" 2>&1)
  grep -q 'Authority=Developer ID Application:' <<<"$dmg_details"
  grep -q "TeamIdentifier=$EXPECTED_TEAM_ID" <<<"$dmg_details"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
  xcrun stapler validate "$dmg"
done

verify_delivery_app() {
  local app_path=$1
  local expected_arch=$2
  codesign --verify --deep --strict --verbose=2 "$app_path"
  local details
  details=$(codesign -dvvv "$app_path" 2>&1)
  grep -q 'Authority=Developer ID Application:' <<<"$details"
  grep -q "TeamIdentifier=$EXPECTED_TEAM_ID" <<<"$details"
  grep -q 'flags=0x10000(runtime)' <<<"$details"
  spctl --assess --type execute --verbose=2 "$app_path"
  xcrun stapler validate "$app_path"
  local actual_version
  actual_version=$(defaults read "$app_path/Contents/Info.plist" CFBundleShortVersionString)
  if [ "$actual_version" != "$VERSION" ]; then
    echo "$app_path has version $actual_version; expected $VERSION." >&2
    exit 1
  fi
  local actual_arch
  actual_arch=$(lipo -archs "$app_path/Contents/MacOS/ClipThat")
  if [ "$actual_arch" != "$expected_arch" ]; then
    echo "$app_path has architecture $actual_arch; expected $expected_arch." >&2
    exit 1
  fi

  local ffmpeg="$app_path/Contents/Resources/third-party/ffmpeg/bin/ffmpeg"
  local ffprobe="$app_path/Contents/Resources/third-party/ffmpeg/bin/ffprobe"
  local build_info="$app_path/Contents/Resources/third-party/ffmpeg/BUILD-FFMPEG.txt"
  [[ -x "$ffmpeg" && -x "$ffprobe" && -s "$build_info" ]] || {
    echo "$app_path does not contain the audited FFmpeg package." >&2
    exit 1
  }
  local buildconf encoders
  buildconf=$("$ffmpeg" -hide_banner -buildconf 2>&1)
  grep -q -- '--disable-gpl' <<<"$buildconf"
  grep -q -- '--disable-nonfree' <<<"$buildconf"
  if grep -qE -- '--enable-(gpl|nonfree)' <<<"$buildconf"; then
    echo "$app_path contains a GPL or nonfree FFmpeg build." >&2
    exit 1
  fi
  if grep -qE '/Users/|build/vendor' <<<"$buildconf"; then
    echo "$app_path contains local FFmpeg build-host paths." >&2
    exit 1
  fi
  encoders=$("$ffmpeg" -hide_banner -encoders 2>&1)
  grep -q 'h264_videotoolbox' <<<"$encoders"
  grep -q 'libvpx-vp9' <<<"$encoders"
  grep -q 'libopus' <<<"$encoders"
  if find "$app_path/Contents/Resources" \( -name '.env' -o -name '.env.*' -o -path '*@ffmpeg-installer*' \) -print | grep -q .; then
    echo "$app_path contains a forbidden environment file or legacy FFmpeg package." >&2
    exit 1
  fi
  [[ -s "$app_path/Contents/Resources/third-party/THIRD_PARTY_NOTICES.md" ]] || {
    echo "$app_path does not contain the combined third-party notices." >&2
    exit 1
  }
  local updater_config="$app_path/Contents/Resources/app-update.yml"
  [[ -s "$updater_config" ]] || {
    echo "$app_path does not contain updater configuration." >&2
    exit 1
  }
  grep -q '^provider: github$' "$updater_config"
  grep -q '^owner: XtraSaltyDev$' "$updater_config"
  grep -q '^repo: clip-that$' "$updater_config"
  node scripts/verify-ocr-assets.mjs --package "$app_path/Contents/Resources"
  node scripts/verify-js-licenses.mjs --package "$app_path/Contents/Resources"
  node scripts/verify-package-secrets.mjs "$app_path/Contents/Resources"
}

for index in 0; do
  dmg=${dmgs[$index]}
  zip=${zips[$index]}
  expected_arch=arm64

  mount_dir=$(mktemp -d "${TMPDIR:-/tmp}/clipthat-dmg.XXXXXX")
  hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount_dir" >/dev/null
  verify_delivery_app "$mount_dir/ClipThat.app" "$expected_arch"
  hdiutil detach "$mount_dir" >/dev/null
  rmdir "$mount_dir"

  zip_dir=$(mktemp -d "${TMPDIR:-/tmp}/clipthat-zip.XXXXXX")
  ditto -x -k "$zip" "$zip_dir"
  verify_delivery_app "$zip_dir/ClipThat.app" "$expected_arch"
  rm -rf "$zip_dir"
done

echo "Verified ClipThat $VERSION: signatures, notarization, Apple-silicon artifacts, audited LGPL FFmpeg, and matching source bundle."
