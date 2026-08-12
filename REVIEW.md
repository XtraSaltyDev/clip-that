# ClipThat — full-project review

Scope: a read-only review of the whole repository (`src`, `tests`, `scripts`, `.github`). Build is
healthy: `tsc --noEmit` is clean and all 169 tests pass. Findings below are a prioritized list of
review items — issues and risks, not exhaustive line edits.

---

## Strengths (worth keeping)

- **Security posture is strong and consistent.**
  - All windows use `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
    `webSecurity: true` (windows/manager.ts, pins.ts, quick.ts, overlay.ts).
  - Renderer identity is enforced per-window (`assertIpcSender` checks the role map, a valid
    `BrowserWindow`, and that the frame is the main frame — ipc/sender.ts). `will-navigate`,
    `setWindowOpenHandler` and webviews are all blocked.
  - Every IPC payload is strictly validated with allowlisted keys + type/range checks
    (validation.ts); the `clipthat://file` protocol resolves symlinks via `isRealPathInside`
    before serving (path-guard.ts, protocol/library-file.ts).
  - The update channel pins a CA and verifies a full certificate chain + hostname before
    accepting a MINOR-cert errors (update/trust.ts). Careful and correct.
- **Storage writes are atomic** across settings, release notes and the library index
  (tmp + `rename`), with a backup generation for the index.
- **Good test coverage of pure logic** (169 tests: transforms, validation, stitch, tilt, cut-out,
  path-guard, byte-range, update trust, etc.), bundled cleanly via esbuild.

---

## Review items (prioritized)

### 1. (High — regression) Rotate-handle UI issues
The recently-added rotation handle in the editor (`Stage.tsx`) has several confirmed UI defects:
- Handle is clamped nowhere — near the bottom/right image edge it renders off-stage and becomes
  unreachable.
- The floating toolbar can cover the handle near the top of the canvas (both can sit below the
  selection).
- The rotate glyph is force-upright (`icon.rotation(0)`) regardless of the selection's angle.
- The rAF used to re-sync the handle is never cancelled on unmount.
- The transparent 20px rotater anchor has invisible clickable corners that don't match the glyph.
- `Shapes.tsx` builds an unused `Arrow` (`node`) every render in the `measure` branch.

These are already documented with fixes in **`FIXPLAN-rotate-ui.md`**.

### 2. (Medium — process) No lint or format enforcement
- No ESLint, Prettier, EditorConfig, husky / lint-staged / hooks anywhere in the repo or CI.
- `npm run build` = native build → typecheck → test → bundle only. TypeScript won't catch
  unused imports, dead variables, or style drift.
- Two `eslint-disable-next-line` comments exist (VideoEditor.tsx:183, ffmpeg.ts:15) but no ESLint
  is configured, so those directives are dead/no-ops.
- **Recommend:** add ESLint (with `@typescript-eslint`) + Prettier, and run both in CI. This also
  makes the existing disable comments meaningful.

### 3. (Medium — process) UI has zero automated coverage
- `scripts/build-tests.mjs` bundles only *pure* modules into `.cache/test`; the ENTRIES list
  contains logic files only — no React components.
- All editor/library/HUD UI (Stage, Shapes, toolbar, panels, overlay) is untested; the only
  guardrail is the dev-only `CLIPTHAT_VISUAL_CHECK` pass.
- This is exactly why the rotate-handle regressions shipped uncaught.
- **Recommend:** at least snapshot/behavioral tests for the transformer/handle positioning, or
  a minimal React testing setup for the canvas; wire the visual check into CI as an optional job.

### 4. (Medium — test gap) Rotate/transform geometry for text & box shapes is under-tested
- `transforms.test.mjs` validates that `rotation` is applied for every family, but only
  *point* shapes get their resulting `x/y/points` asserted. For `text` and `box` shapes under
  rotation it only checks that the `rotation` field is returned — the position math that keeps a
  rotated text/callout/rect on-canvas is not asserted.

### 5. (Low — robustness) Log rotation happens only once at app start
- `rotate()` in `log.ts` is invoked once when the file logger installs; it checks
  `size > MAX_BYTES` and renames to `clipthat.log.1`.
- A single long-lived session can grow the log beyond 1MB; and each launch overwrites the
  previous `.1` backup rather than preserving history.
- **Recommend:** size-checked rotate on write (e.g. every N writes) or at least keep more than
  one generation.

### 6. (Low — robustness) Settings writes have a small crash-loss window
- Settings are committed on a 250ms debounce (`settings.ts`), flushed only on `will-quit`
  (index.ts:220). A hard kill / crash within 250ms of a change loses it. Acceptable for a
  settings file, but worth noting; consider flushing synchronously on the most critical changes.

### 7. (Low — correctness/UX) Unknown `{tokens}` stay literal in filenames
- `formatFilename` (`defaults.ts`) substitutes known tokens and passes unknown ones through
  verbatim; `safeFilename` does not strip `{`/`}`. A typo like `{Month}` produces a filename
  literally containing `{Month}`. **Recommend:** drop unmatched tokens (or keep them — but make
  it intentional).

### 8. (Low — maintainability) `Stage.tsx` is 1138 lines
- The editor canvas mixes stage layout, transformer/rotate logic, floating toolbar, text overlay,
  guides, base/render layers, and cut-out overlay. Consider extracting the recently-added
  "rotation handle" block (sync/position/style/icon) into its own module to reduce coupling and
  make the block independently testable.

### 9. (Low — maintainability) Duplicated `pointsCenter` helper
- `pointsCenter` is defined **identically** in both `canvas/transforms.ts` and `canvas/Shapes.tsx`
  (confirmed identical). If the center semantics change for one, the other silently diverges.
  **Recommend:** extract to a shared module (e.g. `@shared/geometry` or `canvas/geometry.ts`) and
  import from both.

### 10. (Info — robustness) Overlay/OCR worker cleanup is handled, but keep it that way
- The overlay pool retirement timer and the OCR worker idle-close (30s idle, only when
  `activeRequests === 0`) are both correct today. If OCR ever runs concurrently or the worker
  dies mid-request, `requestOcr` relies on a 90s timeout — the promise doesn't otherwise get a
  rejection path. Consider resolving/rejecting sooner on worker `did-fail-load`/close.

---

## Suggested sequencing
Fix item 1 first (ship the pending fix plan), then add lint tooling (2) and close the UI test
gap (3) — those are the highest-leverage changes. Items 5–10 are incremental hardening and
cleanup that can land opportunistically.

No source files were modified during this review.
