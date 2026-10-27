# ClipThat 0.1.25: Library Trash

## Update plan and implementation

The previous Library delete action permanently removed capture files and editable projects.
This update makes that everyday action recoverable:

1. Keep a main-owned `deletedAt` marker in the existing atomic Library index. Move and restore
   commit metadata without moving files or changing user dates, tags, favourites, OCR caches,
   projects, recording drafts or source/derived relationships.
2. Hide Trash items from ordinary Library lists, search, tags, editor opens and background OCR.
   Keep them indexed during startup reconciliation, including incomplete permanent deletions.
3. Add a searchable, paginated Trash workspace ordered by most recently deleted with native checkboxes, batch restore and a named
   permanent-deletion review. Keep the existing renderer controls and confirmation focus trap.
4. Preflight permanent deletion against the capture, recording, project and thumbnail roots.
   Reject symlinks, directories and outside paths. Preserve files referenced by retained records
   and never target an item's external export. Leave incomplete deletions in Trash for retry.
5. Preserve a Trash marker when an already-running editor save finishes. Keep the completed edit
   on that record, invalidate stale OCR and report that restoration is needed. Block purge during
   the selected item's image write and while editor windows are open.

No automatic expiry is used. Moving to Trash does not reclaim storage. Original files remain in
Library storage until permanent deletion. This format is additive; an older ClipThat build that
predates Trash can show marked records in its ordinary Library. Use 0.1.25 or later for review.

Guide deletion retains its existing separate confirmation behavior. Restoring a Trash record
cannot recreate a file that was moved or removed outside ClipThat, or already removed by a partial
permanent deletion; the Trash view reports the available file-health information.

## Source validation

Run `npm run build` for provenance, native helper, quality, typecheck, tests and production bundles.
`tests/library-trash.test.mjs` exercises real temporary files and the production LibraryStore with
isolated paths and a stub Electron image primitive. It covers durable restore, invalid markers,
failed index writes, missing files, unsafe paths, partial deletion and retry, active-save races,
concurrent capture arrivals, shared files, video metadata, OCR exclusion and pagination.

On 2026-10-27, `npm run build` passed all source gates and all 142 tests (15 added for Trash).
The production bundle includes the lazy-loaded Trash workspace. Build output is retained locally
in `.cache/trash-build.log`. No desktop UI was driven or installed application replaced.

These checks do not establish installed-app, permission, hardware or visual acceptance.

## Manual review on disposable captures

Use an isolated development profile as described in [the review test plan](next-level-test-plan.md).
Use `npm run dev`; do not point a test process at your normal Library. For packaged acceptance,
record the exact installed version and follow [RELEASE.md](../RELEASE.md). Do not automate desktop
input or repeat capture overlays during release review.

- [ ] Select a disposable image, add a tag and favourite, annotate it, and save an editable project.
      Export a flattened copy to a temporary external folder. Close the editor.
- [ ] Press Delete in the Library. Check the named review, cancel with Escape, and verify the item
      remains. Repeat and choose Move to Trash. The item should leave ordinary search and tags.
- [ ] Open Trash from the sidebar and from Cmd/Ctrl+K. Search by title, tag and trusted OCR phrase.
      Clear the query; select items using checkboxes and Select all loaded. Load more than one page.
      Use Tab, Space and Cmd/Ctrl+F; check focus rings at compact and expanded sizes in both themes.
- [ ] Quit and reopen the isolated profile. Restore the image. Verify its original date, title,
      tags, favourite, linked export and editable annotations. Reopen its `.clipthat` project.
- [ ] Move a disposable recording with a trim draft and a derived export to Trash. Restore both;
      verify the trim and source/derived relationships. Trashing one must not delete the other.
- [ ] Move an image to Trash while its editor is open. Attempt to save: the editor should report
      that it must be restored, without silently creating a duplicate Library item. Restore and save.
- [ ] In Trash, review Delete permanently…, cancel with Escape, and verify the item remains. Try
      confirming while an editor is open: expect actionable guidance with no deletion.
- [ ] Close editors and permanently delete a disposable item. Its internal capture, thumbnail and
      linked project should disappear. Its external export and unselected captures must remain.
- [ ] Simulate a missing disposable original outside the app. Restart: it must stay in Trash,
      display a missing-file state and allow permanent deletion. Restore cannot reconstruct bytes.
- [ ] If a file deletion fails, expect an error with retry guidance and an indexed Trash item.
      Fix the file access issue and retry; partial deletions must never reappear as active captures.

Manual rows remain pending until a person records the observed result. The installed app and public
release are not changed by source validation.
