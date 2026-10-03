# ClipThat

Electron/Vite, React, TypeScript, and Konva capture/editor app. Preserve offline
capture, OCR, search, non-destructive annotations, and `.clipthat` round-tripping.
Keep main-process authority, preload IPC, and renderer responsibilities separate.

- UI changes use [the UI contract](docs/ui-contract-v1.md) and existing renderer
  primitives. Consult the relevant [README](README.md) section for capture/editor
  behavior rather than reading the whole feature catalog for every edit.
- Use `npm run dev` for development. `npm run typecheck`, `npm test`, and
  `npm run quality` are source checks. `npm run build` already invokes native-helper,
  third-party, quality, typecheck, and test checks; avoid immediately repeating them
  without a change or failure that warrants it.
- Installed capture/permission and release acceptance follow [RELEASE.md](RELEASE.md).
  That workflow requires manual desktop acceptance and prohibits automated input or
  repeated capture-overlay loops during release review. Keep source checks separate
  from installed-app/hardware evidence; a missing printer is not proof of print success.
- macOS Apple silicon is the supported release target; Windows requires its
  [acceptance contract](docs/windows-11-x64-acceptance-v1.md), and Linux build
  configuration alone establishes no runtime support.
- Keep signing identity, audited media/OCR assets, and third-party source/license
  distribution intact. `install:mac` changes the installed app; release and publish
  commands are operational actions, not ordinary source checks. Use them only in
  the authorized task scope. Preserve user capture/library data during verification.
