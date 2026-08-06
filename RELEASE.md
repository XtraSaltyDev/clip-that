# Releasing ClipThat

The build is reproducible from a clean checkout: `npm ci && npm run build` runs the
typecheck and the 77-test suite before bundling, so a broken extractor cannot ship.

## Verification levels

| Level | Command | What it proves |
|---|---|---|
| Unit + regression | `npm test` | extraction, stitching maths, layout, filenames — runs anywhere, ~1s |
| Visual | `CLIPTHAT_VISUAL_CHECK=/tmp/shots npm run dev` | every window renders; annotate → beautify → redact → save round-trips |
| End-to-end | `CLIPTHAT_SELF_TEST=recording,scroll <app binary>` | real screen recording → MP4 and GIF with verified durations; scrolling capture against a live window. Needs Screen Recording permission; results appear as `[selftest]` lines in the log |
| Display diagnostics | `CLIPTHAT_DIAG_DISPLAYS=1 <app binary>` | per-display capture health, for support |

The log lives at `<userData>/logs/clipthat.log` (shown in Settings → About).

## macOS

```bash
npm run install:mac      # build → sign → /Applications, keeps the TCC grant
```

- **Signing is not optional.** Screen Recording permission is keyed to the code identity;
  an ad-hoc signed build loses the grant on every rebuild while System Settings still
  shows it as on. The script auto-detects a `Developer ID Application` certificate.
- **Notarization** (required for distribution outside this machine):

  ```bash
  xcrun notarytool store-credentials clipthat --apple-id <id> --team-id <team>
  npx electron-builder --mac   # produces dmg + zip
  xcrun notarytool submit dist/ClipThat-*.dmg --keychain-profile clipthat --wait
  xcrun stapler staple dist/ClipThat-*.dmg
  ```

  (Or wire `notarize: { teamId }` plus `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD` env vars
  into `electron-builder.yml` to do it in one step.)
- If a machine's permission state gets wedged (capture returns nothing while the toggle
  shows on): `RESET_TCC=1 npm run install:mac`, then re-grant. `killall replayd` clears a
  wedged capture daemon.

## Windows / Linux

```bash
npm run build:win        # nsis installer + portable  (needs a code-signing cert to avoid SmartScreen)
npm run build:linux      # AppImage, deb, rpm
```

**Neither platform has been runtime-tested.** The capture paths are written and typed
(`desktopCapturer` on both; portal picker on Wayland; loopback system audio), and CI
builds them, but before calling a Windows or Linux build releasable someone must run the
end-to-end checklist below on real hardware.

## Manual checklist before tagging

- [ ] Region capture on every attached display; result matches the frozen frame
- [ ] Window capture, fullscreen capture, repeat-last-region
- [ ] Recording with microphone and webcam bubble (self-test covers screen-only)
- [ ] System audio on Windows/Linux
- [ ] Scrolling capture on a real browser page
- [ ] Context panel: table copy, link open, blur-all
- [ ] Library search finds text inside a capture
- [ ] Settings → hotkey rebinding, theme switch, save-folder change
- [ ] Fresh-machine first run: permission flow reads correctly

## Versioning

Bump `version` in `package.json`; the artifact names and the About panel follow it.
No auto-update is wired: `publish: null`. When distribution channels exist, the standard
route is electron-builder's GitHub provider plus `electron-updater` — it was removed as
an unused dependency, so re-adding it is deliberate work, not flipping a flag.
