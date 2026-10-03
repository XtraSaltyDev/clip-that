# ClipThat upgrade: hands-on test plan

This is a local source update. The installed app and public release have not been changed.
All UI, desktop capture, microphone/camera, printing, and packaged-app testing are left to you.

## Start with the isolated review Library

From `/Users/xtrasalty/Projects/clip-that`:

```sh
node scripts/create-review-fixtures.mjs
CLIPTHAT_DEV_USER_DATA="$PWD/.cache/next-level-review" npm run dev
```

The generator preserves an existing review profile. It creates 525 synthetic captures in
`.cache/next-level-review`, separate from your normal captures, settings, and guides. The isolated
app does not claim the global capture hotkeys; start captures from its buttons. Seeded OCR text
is a search fixture, not evidence that OCR ran. Save test exports into a temporary folder.
On the first launch, complete Get started or use its Library action to open the review captures.

## New feature: Compare captures

1. Choose the `compare` tag. Cmd-click (Ctrl-click on Windows) **Compare 01 · Before** and
   **Compare 02 · After**, then choose **Compare** in the selection bar.
2. Drag across the Wipe preview and use its slider with the keyboard. Try Overlay, Difference,
   Before, and After. Switch between fit and analysis pixels. Resize the window.
3. At tolerance 16, the two obvious changes should appear. At 0, a third, subtle sidebar change
   should appear. Select regions: their outlines should match the changed areas.
4. Swap the captures. The changed percentage should stay the same while Before/After exchange.
5. Copy the report and paste into another app. Export PNG, inspect the saved file, and cancel an
   export: labels, dimensions, percentage, tolerance, and selected view should be correct.
6. Compare Before with **Identical to Before**: expect 0%, no regions. Compare Before with
   **Different dimensions**: expect top-left alignment and no stretching. Compare against **Long
   page**: expect the reduced-resolution analysis notice and a responsive interface.
7. Return to Library, select one image or an image plus a recording: Compare should be unavailable.

Comparison uses the saved flattened Library images, including saved annotations. It does not
compare unsaved editor work. The analysis is bounded to four million pixels and a 2400-pixel
edge; very small changes can disappear when large captures are downsampled. Change regions group
nearby pixels, rather than claiming semantic understanding of the screenshot.

## Library

1. Clear the tag, use Load more repeatedly, and reach all 525 items. Try each sort, Grid/List,
   arrows, Enter, Shift-click range selection, and Cmd/Ctrl-click selection.
2. Search `"marcus bell" -draft`: only paid items should match. Search `invoice "marcus bell"`:
   both paid and draft items should match. Type and clear queries quickly; final results should
   follow the final query. Combine search with tags and favourites.
3. Quit/relaunch the isolated app: Grid/List and sort should persist. Try light/dark themes and
   a compact window. Search, sort, view controls, selection actions, and Load more must remain usable.
4. Press Delete on a disposable sample. Review the named items, cancel using Escape, then repeat
   and confirm. Cancel must preserve the item. Confirm should remove its internal files but leave
   an external export intact. Never use your normal Library for deletion tests.

## Editor and output

1. Open a sample, add an arrow, a rectangle, and a step marker. Multi-select them, align each edge
   and centre, then space them horizontally/vertically. Undo/redo should restore each arrangement
   in one step. Lock/hide a layer and verify arranging leaves it in place.
2. Try the colour control on multiple annotations, including a locked one. Locked and hidden
   annotations should keep their colour. Check Layers controls using Tab and Enter.
3. Rename and press Enter. Save, Save As, PNG/JPEG/WebP/PDF export, Copy, Drag out, and Pin should
   still work. Repeated Save/Copy shortcuts should produce one output operation at a time.
4. Start a save, then make a newer edit if the platform permits editing while the dialog is open.
   Finish the save: newer edits must remain unsaved. Cancel or fail a save: edits must remain.
5. Save while a crop draft is active; the pending crop should still be there afterward. Test
   Cut Out, beautify, blur/pixelate, and rotations, and confirm exported images match expectations.
6. Export and reopen `.clipthat`: annotations and crop/canvas settings should remain editable.
   Switch between clips and close an edited window: verify saved Library thumbnails and edits.
7. Test native Print yourself. A successful build cannot establish printer or print-dialog success.

## Recording review, guides, settings, and capture

1. Record a short disposable clip. Enter trim times as `2.5`, `00:04.125`, and `01:02:03.125` on
   a sufficiently long clip. Invalid `1e3`, `-1`, or `00:60` must restore the prior time with guidance.
   Try preview speeds 0.5×–3×. Export must keep normal speed, trim, audio, and framing.
2. Create a guide, edit steps, use **Save now** and Cmd/Ctrl+S, then reopen and verify persistence.
   Export Markdown/HTML/PDF. Review and cancel guide deletion before trying it on a disposable guide.
3. Open Settings, choose **Find a setting** or Cmd/Ctrl+K, and search `theme`, `OCR`, `recording`,
   `shortcuts`, or `diagnostics`. Each should navigate to the relevant section. Change a setting,
   relaunch, and verify it persists.
4. Start Region/Window/Display/Scrolling capture from this isolated app. Test refresh, editor
   visibility, colour copy, keyboard movement, and capture handoff. Capture should be unavailable
   while the frozen scene or editor visibility is updating. Test real OCR, redaction, and Live Text
   on a disposable image with readable text.

## Automated verification

`npm run build` covers the native helper, pinned OCR and dependency licenses, lint, formatting,
TypeScript, unit tests, and production bundles. New tests exercise raster comparison, transparent
padding, tolerance, region bounds, dimension limits, search syntax, arrangement, timecodes,
save-revision checks, and export IPC validation. Automated fixtures use local disposable paths.

Source checks establish local build readiness. Installed permissions, actual UI behavior, devices,
printing, and release acceptance remain hands-on checks under [RELEASE.md](../RELEASE.md).

For this change, the full build passed with 127 tests and no failures. A separate automated check
executed the emitted production worker against the review PNGs: tolerance 16 found 9,360 changed
pixels across two regions (2.34%); tolerance 0 found 10,260 pixels across three regions (2.565%).
Identical images, invalid input, transferable output, and the four-million-pixel maximum frame
also passed. The 525-item fixture index loaded through the real index parser. No app UI was
launched for these checks. Local evidence is in `.cache/next-level-build.log` and
`.cache/next-level-verification.json`.
