export type RotateSide = 'above' | 'below'

export interface RotateBox {
  left: number
  top: number
  width: number
  height: number
}

export interface RotateBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface RotatePoint {
  x: number
  y: number
}

export interface FloatingToolbarBox {
  left: number
  top: number
  width: number
  height: number
  /** Horizontal viewport bounds expressed in the stage-root coordinate space. */
  visibleLeft?: number
  visibleRight?: number
}

export interface FloatingToolbarState {
  transforming: boolean
  box: FloatingToolbarBox | null
}

export interface HorizontalBounds {
  left: number
  right: number
}

export const ROTATE_ANCHOR_GAP = 25
export const ROTATE_ICON_SIZE = 20
export const ROTATE_TOOLBAR_FLIP_TOP = 54
export const ROTATE_TOOLBAR_ABOVE_OFFSET = 46
export const ROTATE_TOOLBAR_BELOW_OFFSET = 8

export function floatingToolbarHidden(): FloatingToolbarState {
  return { transforming: true, box: null }
}

export function floatingToolbarShown(box: FloatingToolbarBox | null): FloatingToolbarState {
  return { transforming: false, box }
}

export function floatingToolbarWithBounds(
  state: FloatingToolbarState,
  box: FloatingToolbarBox | null
): FloatingToolbarState {
  return { ...state, box }
}

export function isFloatingToolbarVisible(state: FloatingToolbarState): boolean {
  return !state.transforming && state.box !== null
}

export function toolbarIsAbove(selectionTop: number): boolean {
  return selectionTop > ROTATE_TOOLBAR_FLIP_TOP
}

/** Return the toolbar's top edge without covering a short selection at the top edge. */
export function floatingToolbarTop(selectionTop: number, selectionHeight: number): number {
  return toolbarIsAbove(selectionTop)
    ? selectionTop - ROTATE_TOOLBAR_ABOVE_OFFSET
    : selectionTop + selectionHeight + ROTATE_TOOLBAR_BELOW_OFFSET
}

/** Convert viewport client edges to the coordinate space used by the stage-root toolbar. */
export function horizontalViewportBounds(
  stageRootLeft: number,
  viewportLeft: number,
  viewportRight: number
): HorizontalBounds {
  return { left: viewportLeft - stageRootLeft, right: viewportRight - stageRootLeft }
}

/** Keep the measured HTML toolbar inside the stage without changing its vertical side. */
export function clampToolbarCenter(
  center: number,
  toolbarWidth: number,
  bounds: HorizontalBounds,
  padding = 4
): number {
  const half = toolbarWidth / 2
  const minimum = bounds.left + padding + half
  const maximum = Math.max(minimum, bounds.right - padding - half)
  return Math.min(Math.max(center, minimum), maximum)
}

export function preferredRotateSide(selectionTop: number): RotateSide {
  return toolbarIsAbove(selectionTop) ? 'below' : 'above'
}

export function oppositeRotateSide(side: RotateSide): RotateSide {
  return side === 'above' ? 'below' : 'above'
}

/** Convert the visual side of the handle into Konva's signed rotateAnchorOffset. */
export function rotateAnchorOffset(height: number, padding: number, side: RotateSide): number {
  const direction = height < 0 ? -1 : 1
  const targetY =
    side === 'below'
      ? height < 0
        ? ROTATE_ANCHOR_GAP
        : height + ROTATE_ANCHOR_GAP
      : height < 0
        ? height - ROTATE_ANCHOR_GAP
        : -ROTATE_ANCHOR_GAP
  return -(targetY + padding) * direction
}

export function rotateHandleRect(
  selection: RotateBox,
  side: RotateSide,
  size = ROTATE_ICON_SIZE
): RotateBox {
  const centerX = selection.left + selection.width / 2
  const centerY =
    side === 'above'
      ? selection.top - ROTATE_ANCHOR_GAP
      : selection.top + selection.height + ROTATE_ANCHOR_GAP
  return {
    left: centerX - size / 2,
    top: centerY - size / 2,
    width: size,
    height: size
  }
}

export function rectOverflow(rect: RotateBox, bounds: RotateBounds): number {
  const right = rect.left + rect.width
  const bottom = rect.top + rect.height
  return (
    Math.max(0, bounds.left - rect.left) +
    Math.max(0, right - bounds.right) +
    Math.max(0, bounds.top - rect.top) +
    Math.max(0, bottom - bounds.bottom)
  )
}

/** Keep the center of the visual handle inside the stage whenever the selection is at an edge. */
export function clampRotateCenter(
  center: RotatePoint,
  size: number,
  bounds: RotateBounds
): RotatePoint {
  const half = size / 2
  const clamp = (value: number, min: number, max: number): number =>
    min > max ? (min + max) / 2 : Math.max(min, Math.min(max, value))
  return {
    x: clamp(center.x, bounds.left + half, bounds.right - half),
    y: clamp(center.y, bounds.top + half, bounds.bottom - half)
  }
}

export function clampedRotateHandleRect(
  selection: RotateBox,
  side: RotateSide,
  bounds: RotateBounds,
  size = ROTATE_ICON_SIZE
): RotateBox {
  const desired = rotateHandleRect(selection, side, size)
  const center = clampRotateCenter(
    { x: desired.left + desired.width / 2, y: desired.top + desired.height / 2 },
    size,
    bounds
  )
  return {
    left: center.x - size / 2,
    top: center.y - size / 2,
    width: size,
    height: size
  }
}

/** Prefer the side that avoids the toolbar, then keep the handle inside the stage. */
export function chooseRotateSide(selection: RotateBox, bounds?: RotateBounds): RotateSide {
  const preferred = preferredRotateSide(selection.top)
  if (!bounds) return preferred

  const alternate = oppositeRotateSide(preferred)
  const preferredOverflow = rectOverflow(rotateHandleRect(selection, preferred), bounds)
  if (preferredOverflow === 0) return preferred
  const alternateOverflow = rectOverflow(rotateHandleRect(selection, alternate), bounds)
  return alternateOverflow < preferredOverflow ? alternate : preferred
}

/**
 * Choose once before a transform, then reuse the chosen side until mouse-up. The caller passes
 * the locked side while a gesture is active so changing screen-space bounds cannot flip it.
 */
export function resolveRotateSide(
  selection: RotateBox,
  bounds: RotateBounds | undefined,
  lockedSide: RotateSide | null
): RotateSide {
  return lockedSide ?? chooseRotateSide(selection, bounds)
}
