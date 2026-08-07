#!/usr/bin/env bash
#
# Build ClipThat and install it somewhere macOS will trust consistently.
#
# Why this exists: macOS ties a Screen Recording grant to an app's *code identity*. For an
# ad-hoc signed app that identity is the hash of its contents, so every rebuild silently
# invalidates the grant — the app keeps appearing in System Settings with its switch on
# while capture quietly returns nothing. Running from ./dist makes it worse, because
# electron-builder deletes and recreates that directory on every build.
#
# So: install to a stable path, sign with a stable identity if one exists, and clear any
# stale TCC entry so the next launch prompts cleanly.
#
#   ./scripts/install-mac.sh
#
# Set SIGN_IDENTITY to a Developer ID or self-signed certificate name to get a grant that
# survives rebuilds:
#
#   SIGN_IDENTITY="ClipThat Local Dev" ./scripts/install-mac.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

BUNDLE_ID="dev.clipthat.app"
APP_NAME="ClipThat.app"
TARGET="/Applications/$APP_NAME"
BUILT="dist/mac-arm64/$APP_NAME"
IDENTITY="${SIGN_IDENTITY:--}"   # "-" means ad-hoc

say() { printf '\033[1m▸ %s\033[0m\n' "$1"; }

say "Building"
npm run build

# Prefer a real Developer ID: it gives the app a code identity that stays constant across
# rebuilds, which is the only way a Screen Recording grant survives a new build. Ad-hoc
# signing hashes the contents instead, so every build looks like a different app.
# electron-builder picks the certificate itself; it wants the bare common name,
# not the full "Developer ID Application: ..." string that `security` prints.
DEV_ID=$(security find-identity -v -p codesigning 2>/dev/null \
  | sed -n 's/.*"Developer ID Application: \(.*\)".*/\1/p' | head -1)

if [ -n "$DEV_ID" ] && [ "$IDENTITY" = "-" ]; then
  say "Packaging and signing as: $DEV_ID"
  # electron-builder signs the nested helpers and frameworks in the right order and
  # applies the entitlements; `codesign --deep` after the fact does neither properly.
  CSC_NAME="$DEV_ID" npx electron-builder --mac --arm64 --dir >/dev/null
else
  say "Packaging (ad-hoc — no Developer ID found)"
  npx electron-builder --mac --arm64 --dir -c.mac.identity=null >/dev/null
  [ -d "$BUILT" ] || { echo "no packaged app found at $BUILT"; exit 1; }
  codesign --force --deep --sign "$IDENTITY" --identifier "$BUNDLE_ID" "$BUILT"
  echo "  ad-hoc: the Screen Recording grant will NOT survive the next rebuild."
fi

[ -d "$BUILT" ] || { echo "no packaged app found at $BUILT"; exit 1; }

say "Verifying signature"
codesign --verify --strict --verbose=1 "$BUILT" 2>&1 | sed 's/^/  /'
codesign -dv "$BUILT" 2>&1 | grep -E "Identifier=|Authority=|TeamIdentifier=" | sed 's/^/  /'

say "Installing to $TARGET"
# A stable path matters as much as a stable signature; ./dist is recreated every build.
if pgrep -f "$APP_NAME/Contents/MacOS" >/dev/null; then
  pkill -f "$APP_NAME/Contents/MacOS" || true
  sleep 1
fi
rm -rf "$TARGET"
cp -R "$BUILT" "$TARGET"
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true

# Only on request. With a stable Developer ID signature the grant survives rebuilds, so
# resetting by default would force a re-grant after every single build.
if [ "${RESET_TCC:-0}" = "1" ]; then
  say "Clearing permission entry (scoped to $BUNDLE_ID)"
  tccutil reset ScreenCapture "$BUNDLE_ID" 2>/dev/null || echo "  (nothing to reset)"
else
  say "Keeping existing permission grant (RESET_TCC=1 to clear it)"
fi

say "Done"
cat <<EOF

  Open it:      open -a "$TARGET"
  Then:         macOS will prompt for Screen Recording — allow it,
                quit ClipThat, and open it again. The grant only takes
                effect on a fresh launch.

  Logs:         /Applications/$APP_NAME/Contents/MacOS/ClipThat
                (run from a terminal to see diagnostics on stdout)
EOF
