# Releasing ClipThat

The build is reproducible from a clean checkout: `npm ci && npm run build` runs the
typecheck and complete test suite before bundling, so a broken extractor cannot ship.

## Verification levels

| Level | Command | What it proves |
|---|---|---|
| Unit + regression | `npm test` | extraction, stitching maths, layout, filenames — runs anywhere, ~1s |
| Visual | `CLIPTHAT_VISUAL_CHECK=/tmp/shots npm run dev` | every window renders; annotate → beautify → redact → save round-trips |
| End-to-end | `CLIPTHAT_SELF_TEST=all <app binary>` | Packaged-app checks for capture latency, retained memory, pin, quick access (including the clipboard), pipeline, scrolling capture, MP4/GIF/auto-zoom recording, and window-picker behavior. Needs Screen Recording permission; results appear as `[selftest]` lines in the log. Individual phases: `CLIPTHAT_SELF_TEST=latency,quick,pipeline` |
| Display diagnostics | `CLIPTHAT_DIAG_DISPLAYS=1 <app binary>` | per-display capture health, for support |

The log lives at `<userData>/logs/clipthat.log` (shown in Settings → About).

## macOS

```bash
npm run install:mac      # build → sign → /Applications, keeps the TCC grant
```

- **Signing is not optional.** Screen Recording permission is keyed to the code identity;
  an ad-hoc signed build loses the grant on every rebuild while System Settings still
  shows it as on. The script auto-detects a `Developer ID Application` certificate.
- **Production release** (signing, notarization, stapling, and verification):

  ```bash
  xcrun notarytool store-credentials vllm-studio-notarize --apple-id <id> --team-id <team>
  APPLE_KEYCHAIN_PROFILE=vllm-studio-notarize npm run release:mac
  ```

  `release:mac` refuses to proceed without a Developer ID Application identity and
  notarization credentials. It builds the Apple-silicon DMG and ZIP, notarizes and staples
  the app and DMG, then checks the signature, hardened runtime, version, Gatekeeper result,
  architecture, and ticket. Apple ID and App Store Connect API-key credentials are
  supported for CI too. Intel macOS is not emitted because the currently bundled FFmpeg
  dependency is Apple-silicon-only in a build produced on this runner.
- The finished local release set is `dist/ClipThat-<version>-arm64.dmg`,
  `dist/ClipThat-<version>-arm64-mac.zip`, and the matching SHA-256 file. The command uses
  `--publish never`; creating these files does not publish a release.
- To create a draft GitHub release from a verified local build without using any hosted
  macOS minutes:

  ```bash
  APPLE_KEYCHAIN_PROFILE=vllm-studio-notarize npm run release:mac
  npm run release:publish:mac
  ```

  Pass `-- --publish` to the second command only when the release should become visible
  immediately. The default is a draft that can be inspected in GitHub first.
- To publish the same tagged, verified macOS release to the VPN-only GitHub Releases channel:

  ```bash
  CLIPTHAT_RELEASE_CA_FILE=/path/to/spark-ca.crt \
    npm run release:publish:spark -- https://github.com/XtraSaltyDev/clip-that
  ```

  The publisher requires a clean `main` checkout, an existing `v<version>` tag, the
  verified DMG/ZIP/checksum set in `dist/`, and SSH access to GitHub Releases. It stages an
  immutable versioned directory, updates stable aliases, then publishes `latest.json`
  last. Override the defaults with `CLIPTHAT_RELEASE_SSH_TARGET` and
  `CLIPTHAT_RELEASE_REMOTE_DIRECTORY` when needed. Its delivery-only verification mode
  reopens both retained artifacts and does not depend on a disposable expanded build
  directory still being present.

  The shareable macOS link is
  `https://github.com/XtraSaltyDev/clip-that/releases/ClipThat-arm64.dmg`; the machine-readable
  release record is `https://github.com/XtraSaltyDev/clip-that/releases/latest.json`. Both are
  reachable without an application credential only from a network path that can reach
  GitHub Releases. A recipient browser must also trust GitHub.s private TLS CA; unmanaged Macs need
  that CA installed and trusted once before the link is frictionless. The package remains
  protected by its Developer ID signature and notarization; the manifest records immutable
  URLs, SHA-256 digests, source commit, and Apple Team ID. The app checks this manifest
  against its bundled public GitHub Releases CA and offers the validated immutable DMG in Library and
  Settings. The browser must still trust that CA for the download itself. This remains a
  browser handoff, not an automatic installer.
- If a machine's permission state gets wedged (capture returns nothing while the toggle
  shows on): `RESET_TCC=1 npm run install:mac`, then re-grant. `killall replayd` clears a
  wedged capture daemon.

### GitHub macOS release

The **macOS Release** workflow is manual-only. Enter the exact version currently in
`package.json`; a small Linux preflight rejects a mismatch or an existing tag before an
expensive macOS runner starts. The macOS job then builds, Developer ID signs, notarizes,
staples, verifies, and uploads the DMG, ZIP, and checksums to a draft GitHub release.

Configure these repository secrets before the first hosted release:

| Secret | Value |
|---|---|
| `MACOS_CSC_LINK` | Base64-encoded Developer ID Application `.p12` certificate |
| `MACOS_CSC_KEY_PASSWORD` | Password used when exporting that `.p12` |
| `APPLE_ID` | Apple Developer account email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Apple Developer team identifier |

Routine CI deliberately does not package desktop applications. It runs one capped Linux
job after a push to `main`, skips documentation-only pushes, cancels superseded runs, and
runs the typecheck, tests, and production bundle. Pull requests do not trigger a second
duplicate run; use the manual CI button when a branch needs validation before merging.

## Unsupported Windows / Linux candidates

```powershell
npm run release:win      # signed x64 NSIS installer + portable EXE + ZIP
```

The Windows release command accepts either Azure Artifact Signing or a normal OV/EV
code-signing certificate. It refuses to emit an unsigned release and verifies both the
Authenticode signature and trusted timestamp, including `ClipThat.exe` inside the ZIP.
Configure the variables documented by the error printed by `scripts/release-win.ps1`.
Windows release automation is intentionally not part of the supported macOS workflow.
Any Windows output remains experimental until `release:win` is run with signing credentials
and the manual checklist passes on Windows test hardware.

Windows ARM64 is deliberately not advertised: the recorder's bundled FFmpeg
does not provide a native ARM64 binary. The x64 package is the candidate to test under
Windows 11 ARM emulation; do not label it supported until that runtime check passes.

```bash
npm run build:linux      # AppImage, deb, rpm (unsigned development artifacts)
```

**Windows and Linux are not supported release targets and have not been runtime-tested in this checkout.** The capture paths are written and typed
(`desktopCapturer` on both; portal picker on Wayland; loopback system audio), and CI
builds them, but before calling a Windows or Linux build releasable someone must run the
end-to-end checklist below on real hardware.

## Manual checklist before tagging

- [ ] Region capture on every attached display; result matches the frozen frame
- [ ] Window capture, fullscreen capture, repeat-last-region
- [ ] Recording with microphone and webcam bubble (self-test covers screen-only + auto-zoom)
- [ ] Quick Access card: drag-out into another app (self-test covers copy)
- [ ] Pipeline shell command against a real destination (S3, scp, webhook)
- [ ] System audio on Windows/Linux
- [ ] Scrolling capture on a real browser page
- [ ] Context panel: table copy, link open, blur-all
- [ ] Library search finds text inside a capture
- [ ] Settings → hotkey rebinding, theme switch, save-folder change
- [ ] Fresh-machine first run: permission flow reads correctly

## Versioning

Bump `version` in `package.json` and `package-lock.json`; the artifact names and the About panel follow it.
No automatic installation is wired: `publish: null`. The in-app update control checks the
fixed internal GitHub Releases manifest and opens its validated, immutable DMG in the default browser;
macOS still handles download, installation, and Gatekeeper verification. Adding a background
installer such as `electron-updater` remains deliberate work, not flipping a flag.

## Cleaning generated artifacts

```bash
npm run clean:artifacts
```

This removes `out/`, test caches, expanded packaging directories, builder scratch data,
block maps, and delivery files from older versions. It keeps the current version's DMG,
ZIP, installer/archive files, and checksum manifests. It never removes `node_modules`,
source files, the installed application, or application data. Use
`node scripts/clean-artifacts.mjs --dry-run` to preview the exact paths first.
