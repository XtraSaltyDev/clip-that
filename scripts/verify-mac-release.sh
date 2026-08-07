#!/usr/bin/env bash

# Verify the exact app bundles and delivery artifacts produced for the current version.

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
EXPECTED_TEAM_ID=${APPLE_TEAM_ID:-ZHK3C6Y5R8}

apps=(dist/mac-arm64/ClipThat.app)
dmgs=(dist/ClipThat-"$VERSION"-arm64.dmg)
zips=(dist/ClipThat-"$VERSION"-arm64-mac.zip)

for artifact in "${dmgs[@]}" "${zips[@]}"; do
  if [ ! -f "$artifact" ]; then
    echo "Missing release artifact: $artifact" >&2
    exit 1
  fi
done

for app_path in "${apps[@]}"; do
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
done

for dmg in "${dmgs[@]}"; do
  xcrun stapler validate "$dmg"
done

verify_delivery_app() {
  local app_path=$1
  local expected_arch=$2
  codesign --verify --deep --strict --verbose=2 "$app_path"
  spctl --assess --type execute --verbose=2 "$app_path"
  xcrun stapler validate "$app_path"
  local actual_arch
  actual_arch=$(lipo -archs "$app_path/Contents/MacOS/ClipThat")
  if [ "$actual_arch" != "$expected_arch" ]; then
    echo "$app_path has architecture $actual_arch; expected $expected_arch." >&2
    exit 1
  fi
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

echo "Verified ClipThat $VERSION: Developer ID signature, hardened runtime, notarization, stapling, and Apple-silicon delivery artifacts."
