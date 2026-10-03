# Contributing to ClipThat

Help is welcome with reproducible bugs, focused features, documentation, accessibility, and
platform testing. Start with the [README](README.md) and search existing
[issues](https://github.com/XtraSaltyDev/clip-that/issues) and
[PRs](https://github.com/XtraSaltyDev/clip-that/pulls). For a large change, describe the problem
in an issue first so the approach can be discussed before you invest in an implementation.
Questions and early ideas can go in [Discussions](https://github.com/XtraSaltyDev/clip-that/discussions).

## Development setup

The supported desktop target is macOS on Apple silicon. Windows x64 is experimental; Linux
build configuration does not establish runtime support. Source checks run in Linux CI, but
that job does not launch or test the desktop app.

Use Node.js **22.13 or later in the 22.x line** and npm (CI selects Node 22). On macOS,
install Apple's Xcode command-line tools; `npm run dev` runs `xcrun swiftc` to build the
Apple-silicon window helper. A contributor does not need release credentials or a signing
certificate to work on source changes.

Fork the repo on GitHub, then clone your fork and create a branch:

```bash
git clone https://github.com/<your-github-username>/clip-that.git
cd clip-that
git switch -c fix/short-description
npm ci
CLIPTHAT_DEV_USER_DATA=/tmp/clipthat-dev npm run dev
```

Replace `<your-github-username>` with your GitHub username. The isolated development profile
keeps the installed app's Library, settings, and single-instance lock separate. It also skips
the tray, login-item changes, and global hotkeys; use the app menu or welcome screen for
capture. Treat `/tmp/clipthat-dev` as disposable test data and use synthetic captures. Plain
`npm run dev` uses the normal ClipThat data profile, so use the isolated form when an installed
copy or real Library is present.

Recording exports need the pinned media tools at `build/vendor/ffmpeg/package/bin/`:

```bash
npm run build:ffmpeg:mac
```

This is a separate Apple-silicon build that downloads and verifies the exact FFmpeg, libvpx,
and Opus sources, then compiles them. The first run can take time. `npm run dev` and
`npm run build` do not prepare these media tools. Windows media-tool prerequisites and package
acceptance are documented in [RELEASE.md](RELEASE.md) and the
[Windows acceptance contract](docs/windows-11-x64-acceptance-v1.md).

## Checks and desktop testing

Use the checks relevant to the change:

| Command                      | Evidence                                                           |
| ---------------------------- | ------------------------------------------------------------------ |
| `npm run typecheck`          | Main, preload, and renderer TypeScript                             |
| `npm test`                   | Non-interactive tests; recreates `.cache/test`                     |
| `npm run quality`            | ESLint and the repository's scoped Prettier checks                 |
| `npm run verify:third-party` | Bundled OCR provenance and locked JavaScript license inventory     |
| `npm run build`              | Native helper, all the preceding gates, then the production bundle |

`npm run build` already runs the source gates; do not immediately repeat them without a new
change or failure. CI runs `npm ci` and `npm run build` in a read-only-token Linux job for
PRs and pushes to `main` and cancels superseded runs. For Markdown/docs-only changes, the
required `validate` status succeeds without installing dependencies or running source gates.
Documentation and issue-form edits still need a careful preview and working links.

Source checks do not prove real capture permissions, device access, print output, or installed
app behavior. Follow [RELEASE.md](RELEASE.md) for manual desktop acceptance and record the
version, hardware, actual observations, and unverified cases. Release review must not drive
mouse/keyboard input or repeat capture-overlay loops. Keep test data separate from real captures.

`npm run install:mac` can quit a running app and replaces `/Applications/ClipThat.app`;
it is not a routine source check. Release and publish commands are maintainer operations.
They require the signing, notarization, artifact, and manual acceptance gates in `RELEASE.md`.

## Change boundaries

- Keep OS access and file authority in `src/main/`, expose narrow typed IPC in `src/preload/`,
  and keep renderers sandboxed. Validate untrusted input at the main-process boundary.
- Preserve offline capture, OCR, and search, editable annotations, and `.clipthat` round-trips.
  Explain any new network request or change to data handling before introducing it.
- For UI work, use existing renderer primitives and [the UI contract](docs/ui-contract-v1.md).
- Preserve originals and Library data. Add regression coverage for behavior or trust-boundary
  changes where it can reproduce the failure without launching Electron.
- Keep audited media/OCR assets, signing identity, license notices, and matching third-party
  source distribution intact. Do not replace pinned binaries or change licenses casually.
- Keep a PR focused; leave unrelated formatting, version bumps, and generated artifacts out.

## Pull requests

Open a PR against `main`; use a **draft PR** while the change or desktop validation is still
in progress. Describe the problem, the resulting behavior, relevant issue, and the checks you
actually ran. Explain skipped or failed checks. For UI changes, include a screenshot or short
recording using synthetic content and describe any manual testing separately from source tests.

Contributions are reviewed before merging. A proposal or passing check does not guarantee
acceptance or a release date. Follow the [community guidelines](CODE_OF_CONDUCT.md), and use
[SECURITY.md](SECURITY.md) for vulnerability reports rather than public exploit details.
