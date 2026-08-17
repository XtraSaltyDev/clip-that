# ClipThat

A modern, private Snagit replacement. Screen capture, non-destructive annotation,
screen recording — and a screenshot that knows what's in it.

The currently supported release target is **macOS on Apple silicon**. Windows x64 is an
experimental package target and Linux is build configuration only; neither has completed
runtime acceptance. No account. No cloud. No telemetry. Capture, recording, text
recognition and search all run offline. The sole automatic network request is an availability
check against the fixed public GitHub release channel; update bytes download only after an
explicit click, and no capture or library content is sent.

```bash
npm install
npm run dev
```

---

## Screen context

A screenshot is normally a dead rectangle of pixels. ClipThat reads it and gives you back
the things inside it — locally, with no model and no network.

Open the **Context** panel (or `⌘K → Screen context`) and you get:

| | |
|---|---|
| **Live Text** | Drag across words *in the screenshot* to select them, then `⌘C`. The image behaves like a page of text. |
| **Sensitive data** | Emails, API keys, JWTs, card numbers (Luhn-checked), IPs, phone numbers, SSNs — found and blurred with one click. Overlapping matches are resolved so a card number is never reported as a phone number. |
| **Tables** | A table in the screenshot comes back out as Markdown or CSV, header row included. |
| **Links, emails, amounts, dates, colours** | Each one copyable, openable, or one click away from being circled in the image. |
| **Palette** | The dominant colours of the capture, as copyable hex. |
| **Suggested name** | The heading in the screenshot, instead of `2026-08-05 at 21.04.11`. |

It also decodes **QR codes** offline, and every capture is **indexed in the background**
whatever you did with it — so the library is searchable by words that only ever appeared
*inside* an image. Search "marcus bell" and find the invoice screenshot you took last
Tuesday.

---

## Where Snagit is weak, and what we do instead

| Snagit today | ClipThat |
|---|---|
| The crosshair captures the **live** screen — menus and tooltips vanish while you aim | Every display is snapshotted first, then a borderless window floats over each one. You select against a **frozen** screen. |
| Annotations get baked into the bitmap | **Fully non-destructive scene graph.** Crop, blur, arrows, text — all stay editable, and round-trip through a `.clipthat` project. |
| No "make this presentable" step | **Beautify**: padding, gradient backgrounds, corner radius, shadow, border, macOS/Windows window chrome, aspect presets, tilt. |
| Redaction is entirely manual | **Auto-redact** finds the secrets for you. |
| Library search is by filename and date | **OCR-indexed library**, grouped as a timeline. |
| Mouse-heavy UI | **Keyboard-first**: `⌘K` command palette, single-key tools, a floating toolbar at the selection, alignment guides, arrow-nudge. |
| Scrolling capture is fragile | Frame stitching that matches two bands lifted from each frame, so sticky headers don't defeat it and a fast scroll still measures. |
| Licensing and activation friction | A plain local app. Nothing phones home. |

---

## Everything else it does

### After the capture
New captures are added to the Library under their default title and open directly in the
editor. If an editor is already open, ClipThat reuses the focused or most recently focused
editor so each capture stays in one working surface. The capture remains linked to its
Library item while you annotate, rename, save, or Save As.

Prefer automation? Switch the after-capture action to **Pipeline** and configure a chain —
copy, save, pin, edit, then a shell command with `{file}` — so one hotkey can save, copy a
link, and upload wherever you like, without ClipThat needing a cloud of its own.

### Capture
- **Region** — frozen-frame selection with a pixel loupe, live dimensions in native pixels, and a hex eyedropper (`C` copies the colour under the cursor).
- **Window** — a visual picker with live thumbnails and app icons. On macOS the grab goes through `screencapture -l` for true native-resolution pixels.
- **Screen / all screens** — multi-monitor captures composited in virtual-desktop space at the highest DPI present, so a Retina panel next to a 1080p one isn't downsampled.
- **Repeat last region**, **delayed capture**, **paste from clipboard**, **scrolling capture**.

### Editor
| | Tools |
|---|---|
| Draw | arrow (curvable, heads either end), line, pen, highlighter |
| Shapes | rectangle, ellipse, text, callout with a draggable tail, rotatable annotations, auto-numbered step markers |
| Conceal | blur, pixelate, solid redact, Cut Out |
| Emphasise | spotlight, magnifier, measurement with a live pixel readout |

Full undo/redo, multi-select, a layers panel, snapping alignment guides, and a floating
toolbar that appears at whatever you've selected.

### Recording
Screen or window, 15–60 fps, microphone, a circular
**webcam bubble** composited into the video, and **auto-zoom** — a smoothed camera that
follows your cursor with a dead-zone, so recordings read like produced video instead of a
raw screen dump. Floating controller with pause/resume, then a
review step with trimming and export to **MP4 (H.264)**, **GIF** (two-pass palette), or **WebM**.
Library recordings open in ClipThat's video editor, where trim drafts persist, a selection can
be played or looped, timecodes can be entered precisely, and exports remain non-destructive.
On macOS 13 and later, recording can include native system audio without a virtual audio
device. Windows/Linux system-audio paths exist in source but are not supported or
runtime-accepted features.

### Library
Grid or list, grouped into Today / Yesterday / weekday / date. Tags, favourites, full-text
search over image contents, supported Snagit image/video import with duplicate detection,
keyboard navigation, and its own `⌘K` palette.

---

## Keyboard

**Global** (configurable in Settings → Shortcuts)

| | |
|---|---|
| `⌘⇧2` | Capture region |
| `⌘⇧3` | Capture window |
| `⌘⇧4` | Capture screen |
| `⌘⇧5` | Repeat last region |
| `⌘⇧6` | Scrolling capture |
| `⌘⇧7` / `⌘⇧8` | Start / stop recording |
| `⌘⇧9` | Library |
| `⌘⇧T` | Grab text (OCR to clipboard) |

**Editor** — `⌘K` command palette · `V` select · `C` crop · `A` arrow · `L` line · `P` pen ·
`H` highlighter · `R` rect · `O` ellipse · `T` text · `Q` callout · `S` step · `U` blur ·
`X` pixelate · `K` redact · `G` spotlight · `M` magnify · `D` measure ·
`⌘Z`/`⇧⌘Z` undo/redo · `⌘D` duplicate · `⌘0` fit · arrows nudge (`⇧` = 10px).

**Capture overlay** — drag to select · `⌘A` whole screen · `C` copy colour under the cursor ·
arrows nudge, `⌥`+arrows resize · `Enter` confirm · `Esc` cancel.

**Library** — `⌘K` palette · `⌘F` search · arrows navigate · `Enter` open · `⌫` delete.

---

## Architecture

```
src/
  shared/     types + IPC channel table, imported by every process
  main/       Electron main — the only process with OS access
    capture/  platform backends, multi-display snapshots, scroll stitcher
    recording/ session state machine, ffmpeg encode/trim
    store/    settings + library index (plain JSON, no native deps)
    windows/  overlay, editor, library, HUD, settings window managers
    ocr.ts    OCR request bus + background library indexer
    dev/      opt-in display diagnostics for support
  preload/    one typed contextBridge surface: window.clipthat
  renderer/
    shared/   design system, command palette, OCR, extraction engine
    editor/   canvas, panels, commands
    overlay/ library/ hud/ settings/
```

- **Electron 43 + electron-vite + React 18 + TypeScript.**
- **Konva** for the editor scene graph, split across three layers: the screenshot, the
  annotations, and the UI. Annotating never repaints the screenshot, and shape nodes are
  memoised so editing one shape doesn't rebuild every blur filter on the canvas.
- Export renders that **same** stage at 1:1, so the file you save is pixel-identical to the
  preview, filters included.
- **tesseract.js** for OCR, with the worker, WASM core and English model all bundled locally.
- **ffmpeg** ships with the app via `@ffmpeg-installer`.
- **No native node modules**, so `npm install` never needs a compiler.

Renderers run sandboxed with `contextIsolation` on and `nodeIntegration` off, behind a strict CSP.
Library files reach the UI through a `clipthat://` protocol handler that refuses any path
outside the library directory.

### Per-platform notes

| | macOS | Windows | Linux |
|---|---|---|---|
| Release status | **Supported: Apple silicon** | Experimental x64 candidate; no runtime acceptance | Build configuration only; no runtime acceptance |
| Capture | `screencapture -R` per display (the full-display forms fail in-process); `desktopCapturer` as fallback only | `desktopCapturer` | `desktopCapturer` (X11), portal picker (Wayland) |
| System audio | Native capture on macOS 13+ | loopback path, unverified | loopback path, unverified |
| Permissions | Screen Recording must be granted; the app verifies by actually reading pixels, not by trusting the status flag | — | — |

---

## Development

```bash
npm run dev            # run the app
npm run build          # lint + format check + typecheck + bundle
npm run build:mac      # Apple-silicon dmg + zip
npm run build:win      # experimental x64 packages; not runtime acceptance
npm run build:linux    # unsigned development packages; not runtime acceptance
node build/gen-icons.mjs   # regenerate the icon set from source, no image deps
```

ClipThat deliberately has no automated test or UI-driving harness. Automated Electron
acceptance previously took over the active displays and input devices. Validate changes by
driving the real app manually while leaving the user's mouse and keyboard under their control.
The build retains non-interactive source checks: ESLint, Prettier, TypeScript, and the
production bundle.

Useful non-driving diagnostics remain available:

```bash
# Run the real extraction engine over a PNG and print what it found.
npm run extract-check -- /path/to/capture.png

# Print per-display capture health for support without clicking or typing.
CLIPTHAT_DIAG_DISPLAYS=1 /Applications/ClipThat.app/Contents/MacOS/ClipThat
```

Before a release, use the manual checklist in `RELEASE.md` against the installed app. A clean
build is source evidence; it is not a substitute for observing capture, editing, recording,
export, library, and settings behavior in the actual interface.

On macOS, `npm run install:mac` builds, signs (Developer ID if present), installs to
/Applications and preserves the Screen Recording grant. See RELEASE.md for the full
release flow and manual checklist.

To remove expanded package trees, older delivery files, and other generated build output
while retaining the current and directly previous release packages, updater metadata, and
blockmaps, run `npm run clean:artifacts`.

## Known limits

- Click ripples / cursor highlighting in recordings would need OS-level input hooks, which
  Electron can't do without a native module. The system cursor is captured normally.
- The 3D tilt is a skew-and-foreshorten approximation — Konva has no perspective camera.
- Scroll stitching assumes you scroll one direction, downward, without resizing the window.
  A single frame-to-frame jump larger than roughly 70% of the viewport can't be measured
  and is dropped rather than mis-stitched.
- OCR is English-only as shipped; other Tesseract models drop into `src/renderer/public/ocr`.
