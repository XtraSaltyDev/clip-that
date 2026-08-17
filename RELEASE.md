# Releasing ClipThat

The build is reproducible from a clean checkout: `npm ci && npm run build` runs lint,
formatting, typechecking, and the production bundle. These are non-interactive source gates;
installed-app acceptance is manual.

## Verification levels

| Level | Method | What it proves |
|---|---|---|
| Source gates | `npm run build` | lint, formatting, TypeScript, and the production bundle are clean without driving the UI |
| Installed app | Manually exercise the checklist below | the actual signed app behaves correctly with real permissions and hardware |
| Display diagnostics | `CLIPTHAT_DIAG_DISPLAYS=1 <app binary>` | read-only per-display capture health for support |

There is intentionally no automated test or UI-driving acceptance command. Release review must
not synthesize mouse or keyboard input, open capture overlays in a loop, or take over the active
desktop. Record the installed app version and the manually observed result for each checklist
item instead.

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
  `dist/ClipThat-<version>-arm64-mac.zip`, its ZIP blockmap, `dist/latest-mac.yml`, and
  the matching SHA-256 file. The command uses
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
  verified DMG/ZIP/blockmap/metadata/checksum set in `dist/`, and SSH access to GitHub Releases.
  It stages an immutable versioned directory, publishes the updater ZIP and blockmap,
  validates byte-range responses, updates stable aliases, then moves `latest-mac.yml`
  and legacy `latest.json` only after their artifacts are live. Override the defaults with
  `CLIPTHAT_RELEASE_SSH_TARGET` and
  `CLIPTHAT_RELEASE_REMOTE_DIRECTORY` when needed. Its delivery-only verification mode
  reopens both retained artifacts and does not depend on a disposable expanded build
  directory still being present.

  The shareable macOS link is
  `https://github.com/XtraSaltyDev/clip-that/releases/ClipThat-arm64.dmg`; the machine-readable
  legacy release record is `https://github.com/XtraSaltyDev/clip-that/releases/latest.json`, and
  managed clients read `https://github.com/XtraSaltyDev/clip-that/releases/latest-mac.yml`. These are
  reachable without an application credential only from a network path that can reach
  GitHub Releases. A recipient browser must also trust GitHub.s private TLS CA; unmanaged Macs need
  that CA installed and trusted once before the link is frictionless. The package remains
  protected by its Developer ID signature and notarization; the manifest records immutable
  URLs, digests, source commit, and Apple Team ID. ClipThat verifies the narrowly scoped
  GitHub Releases certificate chain, downloads a signed update only after the user asks, and offers
  an explicit restart. The immutable DMG remains the manual recovery path.

  A manual DMG install does not seed electron-updater's previous `update.zip`. The first
  updater-managed upgrade is therefore a full ZIP download; later consecutive upgrades
  can use ZIP blockmaps. Before shipping the bootstrap release, prove this with an installed
  RC chain: RC1 → RC2 must log the expected full fallback, then RC2 → RC3 must log a
  differential transfer smaller than the full ZIP.
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
runs lint, formatting, typechecking, and the production bundle. Pull requests do not trigger a
second duplicate run; use the manual CI button when a branch needs validation before merging.

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
- [ ] Recording with screen, system audio, microphone, webcam bubble, pause/resume, and auto-zoom
- [ ] Quick Access card: copy and drag-out into another app
- [ ] Pipeline shell command against a real destination (S3, scp, webhook)
- [ ] System audio on Windows/Linux
- [ ] Scrolling capture on a real browser page
- [ ] Context panel: table copy, link open, blur-all
- [ ] Library search finds text inside a capture
- [ ] Settings → hotkey rebinding, theme switch, save-folder change
- [ ] Fresh-machine first run: permission flow reads correctly

## Versioning

Bump `version` in `package.json` and `package-lock.json`; the artifact names and the About panel follow it.
The in-app control checks the fixed generic GitHub Releases feed, downloads only after explicit user
action, reports progress, and restarts only after explicit confirmation. Installation is
blocked while a recording is active or an editor window is open. The legacy JSON/DMG path
stays published so older clients and managed-update failures have a manual recovery route.

## Cleaning generated artifacts

```bash
npm run clean:artifacts
```

This removes `out/`, local caches, expanded packaging directories, builder scratch data,
and delivery files older than the direct previous version. It keeps the current and
directly previous DMG, ZIP, blockmap, installer/archive and checksum files plus current
updater metadata. It never removes `node_modules`,
source files, the installed application, or application data. Use
`node scripts/clean-artifacts.mjs --dry-run` to preview the exact paths first.
