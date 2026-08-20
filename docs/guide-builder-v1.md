# Guide Builder v1

Guide Builder is a local-first workspace for turning captured or imported images into an ordered guide. Guides are stored under ClipThat's user-data Library in a dedicated `guides` store; guide manifests contain only relative asset references. Images, editable `.clipthat` projects, thumbnails, and flattened annotation renders remain local.

## Capture modes

- Manual **Capture next** offers region, window, display, all-display, and last-region capture through the existing platform backend. The macOS development build was exercised with the deterministic acceptance source because real screen capture was unavailable on the verification host. Windows shares the compile-checked capture path but still requires real-hardware acceptance.
- **Start session** makes the configurable “Capture next guide step” global shortcut target the open guide. Stop ends that session immediately.
- Automatic click capture is unavailable in v1. ClipThat does not install a mouse hook, monitor keyboard input, or use a transparent click-stealing overlay.
- Scrolling capture is intentionally excluded from Guide Builder v1 because its asynchronous controller currently owns normal after-capture routing.

Guide capture bypasses the user's ordinary after-capture route. It does not copy to the clipboard, insert a media Library item, save to the normal destination, or open Quick Access.

## Persistence and recovery

`GuideDocument` and `GuideStep` are separately versioned at v1 and strictly validated. A guide is limited to 100 steps, bounded text and image sizes, unique stable step IDs, and contiguous ordering. Writes use same-directory temporary files and atomic rename. The last complete manifest is retained as `guide.json.bak` and is used when the primary manifest cannot be loaded.

## Export

- Markdown creates an adjacent `<guide-name>-assets` folder and relative PNG links.
- HTML is self-contained, semantic, responsive, printable, and escapes all guide text.
- PDF uses Electron's existing `printToPDF` path with an ordered, multi-page A4 layout.

Every format uses the latest flattened annotation render when one exists. No network service, account, telemetry dependency, paid service, or proprietary runtime asset is involved.

Automated real-app acceptance may set both `CLIPTHAT_ACCEPTANCE_PROFILE=1` and an absolute `CLIPTHAT_ACCEPTANCE_EXPORT_DIR`. That explicit test-only combination bypasses native save dialogs and writes only to the supplied isolated evidence directory; ordinary launches always use the native dialog.

The same explicit acceptance profile may set an absolute `CLIPTHAT_ACCEPTANCE_CAPTURE_FIXTURE`. Guide capture and recapture then read only that known local image instead of accessing a real display or device. Ordinary launches never use this deterministic backend.

DOCX, PPTX, automatic click capture, and cloud sharing are future work.
