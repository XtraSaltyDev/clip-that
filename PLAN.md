# ClipThat — a modern, cross-platform Snagit replacement

## 0. Goal

A local-first screen capture + annotation + recording app for **macOS, Windows and Linux** that
does what Snagit does, but with a faster, keyboard-driven, non-destructive execution.

No account. No cloud. No telemetry. Everything runs offline.

---

## 1. Where Snagit is weak, and what we do instead

| Snagit today | ClipThat |
|---|---|
| Crosshair captures the **live** screen — menus and tooltips vanish while you aim | We snapshot every display first, then show a **frozen fullscreen overlay**. You can select over an open menu, and selection is pixel-exact with a loupe. |
| Annotations get baked into the bitmap on many operations | **Fully non-destructive scene graph.** Crop, blur, arrows, text — all stay editable forever, saved in a `.clipthat` project. |
| No "make this screenshot presentable" step | **Beautify pipeline**: padding, gradient / solid / image backgrounds, drop shadow, rounded corners, inset border, 3D tilt, window-chrome frames. |
| Redaction is fully manual | **Auto-redact**: OCR the capture, regex for emails, IPs, card numbers, JWTs, API keys, phone numbers → one-click blur of everything found. |
| Library search is by filename/date | **OCR-indexed library.** Every capture's text is extracted and full-text searchable. |
| Mouse-heavy UI | **Keyboard-first**: single-key tools, arrow nudging, snapping, alt-drag duplicate, everything has a shortcut. |
| Scrolling capture is fragile | Frame-stitching scroll capture using normalized cross-correlation on overlap strips. |
| Licensing / activation friction | Plain local app. Nothing phones home. |

---

## 2. Tech stack and why

- **Electron 33 + electron-vite + TypeScript + React 18** — the only runtime that genuinely
  ships one codebase to all three desktop OSes with screen-capture, global hotkeys, tray and
  native clipboard. Tauri was considered but Rust isn't installed here and its capture story
  still leans on per-OS crates.
- **Konva / react-konva** for the editor canvas — a real retained-mode vector scene graph with
  hit testing and transform handles. This is what makes non-destructive editing tractable.
- **Zustand** for renderer state, with a dedicated history middleware for undo/redo.
- **tesseract.js** (WASM) for OCR — offline, no native build.
- **ffmpeg-static + fluent-ffmpeg** for MP4/GIF encode, trim and remux.
- **electron-builder** for dmg / nsis+portable / AppImage+deb+rpm.
- **No native node addons.** Storage is JSON + files on disk, so `npm i` never needs a compiler.

### Capture backends (the one genuinely per-OS piece)

| OS | Backend |
|---|---|
| macOS | `screencapture` CLI (`-x -r -D<n>`) → true Retina pixels, plus `-l<winid>` for window capture. Window list via `CGWindowList` through a tiny helper using `desktopCapturer` + AppleScript fallback. |
| Windows | `desktopCapturer.getSources` with `thumbnailSize` set to the display's full pixel size (returns full-res on Win). |
| Linux | Same as Windows on X11; on Wayland fall back to `getDisplayMedia` + the xdg-desktop-portal picker. |

All three normalize to `{ png: Buffer, width, height, scaleFactor, displayId }`.

---

## 3. Architecture

```
src/
  shared/            types + IPC contract shared by all processes
  main/              Electron main
    capture/         darwin.ts | win32.ts | linux.ts + displays.ts
    recording/       session manager, ffmpeg encode/trim/gif
    store/           settings.json, library index, file layout
    windows/         overlay, editor, library, recorder-hud window managers
    ipc/             typed handlers
    hotkeys.ts  tray.ts  permissions.ts
  preload/           contextBridge, one typed `window.clipthat` surface
  renderer/
    overlay/         frozen-frame region selector (its own entry)
    editor/          annotation editor (its own entry)
    library/         capture browser (its own entry)
    shared/          design system, hooks, canvas primitives
```

Four renderer entries, four HTML files, one preload. Main process owns all OS access; the
renderer never touches `fs` or `child_process`.

---

## 4. Feature build order

**P1 — Foundation**
scaffold, build config, IPC contract, typed preload, design tokens, app shell, tray, settings store.

**P2 — Capture engine**
multi-display snapshot, frozen overlay window per display, region select with loupe + live
dimensions + hex eyedropper, window detection & highlight, fullscreen/display capture, delayed
capture, repeat-last-region, clipboard capture.

**P3 — Editor core**
Konva stage, layer model, selection/transform, undo-redo, non-destructive crop, and tools:
select, crop, arrow, line, pen, highlighter, rectangle, ellipse, text, callout, step counter,
blur, pixelate, solid redact, spotlight/dim, magnify, image stamp, measure.

**P4 — Beautify**
padding, background (solid/gradient/image/desktop-blur), shadow, corner radius, border,
3D tilt, macOS/Windows window frames, aspect-ratio presets for social.

**P5 — Recording**
`getDisplayMedia` + `MediaRecorder` capture, mic + system audio, webcam PiP, click ripples and
cursor spotlight, floating HUD with pause/stop, then ffmpeg → MP4 (h264) / GIF / WebM, trim UI.

**P6 — Library**
disk-backed capture store, grid browser, tags, favorites, rename, delete, reopen in editor,
drag-out to other apps, OCR text index + full-text search.

**P7 — Intelligence**
OCR "grab text", auto-redact scanner, smart color sampling for annotation defaults.

**P8 — Scrolling capture**
capture-on-scroll frames, cross-correlation stitcher, preview + accept.

**P9 — Export & polish**
PNG/JPG/WebP/PDF/`.clipthat`, copy to clipboard, save presets, quick-export hotkeys,
global hotkeys, preferences window, first-run permission coach for macOS Screen Recording,
onboarding, about, docs.

---

## 5. Definition of done

- `npm run dev` launches the app on macOS with working capture → editor → export.
- `npm run build:mac|win|linux` produces installers.
- Every tool in P3 works with undo/redo and survives save/reload of a `.clipthat` project.
- Recording produces a playable MP4 and a GIF.
- Library search finds a capture by words visible inside the image.
- No crashes on multi-monitor, mixed-DPI setups.
