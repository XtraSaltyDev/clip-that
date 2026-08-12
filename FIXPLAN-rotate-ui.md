# Fix plan — rotate annotation UI issues

Scope: the (currently uncommitted) rotate-handle work in `Stage.tsx`, `Shapes.tsx`, `transforms.ts`.
Read-only review produced six issues. This plan fixes each, ordered by severity.
Where possible, fixes are independent — each can land and be verified on its own.

> Note: the transform *math* is correct and covered by `tests/transforms.test.mjs`; none of
> these changes alter geometry. All are UI/formatting/lifecycle concerns.

---

## 1. (High) Rotate handle pushed off-canvas — clamp it like the floating toolbar

**Files:** `src/renderer/editor/canvas/Stage.tsx` (`syncRotateAnchor`, ~128–146; toolbar clamp ~756–762)

**Problem:** the handle sits a fixed `ROTATE_ANCHOR_GAP` below the selection and is never kept
on-screen, so near the bottom/right image edges it renders off-stage and becomes unreachable.

**Fix:**
1. Read the stage bounds from `stageRef.current` (or `layout.canvasWidth/Height` + `zoom`) and
   the handle's target absolute position (`anchor.getAbsolutePosition()`).
2. When the computed bottom-placed handle Y would fall outside the visible stage, flip it
   *above* the selection (same distance), mirroring the toolbar's `above`/below toggle.
   Generalize the helper:
   ```
   const below = () => /* handle 25px below selection bottom */
   const above = () => /* handle 25px above selection top  */
   if (below target within stage)  offset = offsetBelow()
   else if (above target within stage) offset = offsetAbove()
   else keep the closer of the two (best effort when selection fills the stage)
   ```
3. Keep `ROTATE_ANCHOR_GAP`/`ROTATE_ICON_SIZE` as the single source of the gap (no magic numbers).

**Verify:** select a shape at the very bottom and very right of the image; handle must remain
grab-able. Rotate a full-height selection; handle should still be reachable.

---

## 2. (High) Floating toolbar can cover the rotate handle near the top

**Files:** `src/renderer/editor/canvas/Stage.tsx` (`RotateIcon`/`syncRotateAnchor`, `FloatingToolbar ~714–800`)

**Problem:** the handle is placed *below* the selection assuming the toolbar is *above* it.
When the selection is near the top (`box.top <= 54`) the toolbar flips to just below the
selection and can overlap the handle for short selections.

**Fix (coordinate the two, pickup whichever is simplest and robust):**
- **Option A (preferred):** give the rotation handle knowledge of the toolbar's decision.
  Compute the same `box.top` the toolbar uses; when the toolbar goes below (`box.top <= 54`),
  place the rotate handle above the selection instead of below (reuse the clamp from item 1).
- **Option B:** raise the toolbar's flip threshold (e.g. account for `ROTATE_ANCHOR_GAP`)
  so it stays above except when truly necessary. Simpler but only shrinks, not removes,
  the conflict window.
- Expose the toolbar's `above` decision as a small computed value shared by both, so the two
  elements can never choose the same region.

**Verify:** with a short selection near the canvas top, the toolbar and rotation handle must not
overlap; both remain visible and clickable. Regression-check the normal "selection in middle"
case (toolbar above, handle below — no overlap as today).

---

## 3. (Medium) Rotate glyph always forced upright

**Files:** `src/renderer/editor/canvas/Stage.tsx` (`syncRotateIcon`, ~109–126)

**Problem:** `icon.rotation(0)` on every sync keeps the circular-arrow glyph upright even for a
90°/180°-rotated selection, so the handle reads disconnected from the object it controls.

**Fix:**
- Read the current single-node/selection rotation from the transformer
  (`transformer.rotation()` / `transformer.nodes()[0].getAbsoluteRotation()`).
- Set `icon.rotation(selectionRotation)` instead of `0`, so the glyph mirrors the annotation's
  angle (visually "rides" the selection).
- If the product decision is deliberately to keep the glyph upright for readability, keep `0`
  but add a comment documenting the intent so it isn't mistaken for a bug. Prefer rotating to
  match the selection for a consistent directional cue.

**Verify:** rotate a shape to 90° / 180° / 270°; the ring/arrow glyph follows the angle and the
drag still starts/stops on the handle correctly.

---

## 4. (Low) Pending rotate-sync rAF is never cancelled on unmount

**Files:** `src/renderer/editor/canvas/Stage.tsx` (`scheduleRotateAnchorSync`, ~148–155)

**Problem:** `rotateSyncFrame` is stored but never cancelled; if the editor unmounts with a frame
pending, the callback still fires `syncRotateAnchor()` → `batchDraw()` on a torn-down stage.

**Fix:**
- Add a cleanup effect:
  ```tsx
  useEffect(() => {
    return () => {
      if (rotateSyncFrame.current !== null) {
        cancelAnimationFrame(rotateSyncFrame.current)
        rotateSyncFrame.current = null
      }
    }
  }, [])
  ```
- Optionally guard `syncRotateAnchor`/`syncRotateIcon` against a null `stageRef`/layer for extra
  safety.

**Verify:** App has no warnings on close during/right after a rotate. Component cleanup is idempotent.

---

## 5. (Low) Invisible hit-area on the rotater's transparent square corners

**Files:** `src/renderer/editor/canvas/Stage.tsx` (`styleTransformerAnchor`, ~157+; `RotateIconGroup`, ~607+)

**Problem:** the rotater is a transparent 20×20 anchor while the visible glyph is a 10px-radius
circle; the transparent square's corners capture drags with no visible affordance.

**Fix:**
- Keep the 20×20 transparent anchor as the drag target (needed to beat nearby shapes), but
  shrink the *visual* mismatch by one of:
  - Set the transparent anchor hit size closer to the glyph (e.g. a 20px circle via a `Circle`
    drag proxy) while keeping the square anchor, **or**
  - Leave the anchor as-is but the trade-off is documented; the important thing is it does not
    silently cover the *corner resize anchors* next to it. Measure the actual gap (currently
    `GAP=25` vs bottom-corner anchor at ~`padding+anchorSize/2`, so it already clears) and assert
    it stays clear.
- Confirm the glyph (on top, `listening=false`) and the anchor never double-fire or block the
  corner resize anchors.

**Verify:** clicking the visible circle starts a rotate; clicking the corner anchors still resizes;
no dead/ambiguous region between handle and bottom corners.

---

## 6. (Low) Dead reload — construct the arrow/node once for all arrow-family shapes

**Files:** `src/renderer/editor/canvas/Shapes.tsx` (`arrow`/`line`/`measure` case, ~339–446)

**Problem:** the measure branch builds a standalone `node`/`Arrow` then discards it and builds a
second Arrow inside a `Group` — an unused Konva node created every render.

**Fix:**
- Refactor so the base `Arrow` is built once and shared:
  - Build the arrow element once (points, curve, head geometry, shadow).
  - For `measure`, wrap it in the `Group` (length label + recenter) *at the same time* rather
    than constructing a second arrow.
  - Only non-measure returns the bare arrow; measure returns the group, reusing the same points.
- Keep behavior identical; this is formatting/cleanliness only.

**Verify:** line, arrow, and measure all render/rotate/drag exactly as before
(`tests/transforms.test.mjs` still green; manual drag + rotate on each).

---

## Rollback & integration

- Each item is independent; land in the numbered order, running
  `node tests/transforms.test.mjs` + `npm run dev` per step.
- Do not commit until item 1 and 2 (the usability regressions) are visibly verified in-app.
- All changes stay confined to the three canvas files; no shared types or IPC changes.
