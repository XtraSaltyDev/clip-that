import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type Konva from 'konva'
import {
  clampRotateCenter,
  rotateAnchorOffset,
  resolveRotateSide,
  ROTATE_ICON_SIZE,
  type RotateBox,
  type RotateSide
} from './rotation-handle'
import type { RotateBounds } from './rotation-handle'

export interface RotateHandleRefs {
  stageRef: MutableRefObject<Konva.Stage | null>
  transformerRef: MutableRefObject<Konva.Transformer | null>
  iconRef: MutableRefObject<Konva.Group | null>
}

export interface RotateHandleActions {
  beginTransform: () => void
  endTransform: () => void
  syncRotateAnchor: () => void
  scheduleRotateAnchorSync: () => void
  styleTransformerAnchor: (anchor: Konva.Rect) => void
}

function selectionBox(transformer: Konva.Transformer): RotateBox | null {
  const nodes = transformer.nodes()
  if (nodes.length === 0) return null

  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    const rect = node.getClientRect()
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.width)
    bottom = Math.max(bottom, rect.y + rect.height)
  }
  return { left, top, width: right - left, height: bottom - top }
}

function stageBounds(stage: Konva.Stage | null): RotateBounds | undefined {
  const rect = stage?.getClientRect()
  return rect
    ? { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height }
    : undefined
}

function anchorVisualCenter(anchor: Konva.Node): { x: number; y: number } {
  const rect = anchor.getClientRect()
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function keepAnchorInsideStage(anchor: Konva.Node, bounds: RotateBounds): void {
  const position = anchorVisualCenter(anchor)
  const target = clampRotateCenter(position, ROTATE_ICON_SIZE, bounds)
  if (Math.abs(target.x - position.x) < 0.1 && Math.abs(target.y - position.y) < 0.1) return

  // Change the anchor's offset rather than its local x/y. Konva's rotation math uses the
  // local anchor coordinates, so this keeps the handle grab-able at the edge without
  // introducing a rotation jump when the drag starts.
  const inverse = anchor.getAbsoluteTransform().copy().invert()
  const from = inverse.point(position)
  const to = inverse.point(target)
  anchor.offset({
    x: anchor.offsetX() - (to.x - from.x),
    y: anchor.offsetY() - (to.y - from.y)
  })
}

/** Own the Transformer-specific rotate handle lifecycle outside the large canvas component. */
export function useRotateHandle({
  stageRef,
  transformerRef,
  iconRef
}: RotateHandleRefs): RotateHandleActions {
  const rotateSyncFrame = useRef<number | null>(null)
  const transformActive = useRef(false)
  const lockedSide = useRef<RotateSide | null>(null)

  const syncRotateIcon = useCallback(() => {
    const icon = iconRef.current
    const transformer = transformerRef.current
    const anchor = transformer?.findOne('.rotater')
    if (!icon) return

    if (!transformer || transformer.nodes().length === 0 || !anchor || !anchor.visible()) {
      icon.visible(false)
      return
    }

    // The icon is a listening=false sibling of the Transformer. Positioning it from the
    // actual rotater anchor keeps the visual glyph aligned while the transparent anchor
    // underneath remains the drag target.
    icon.absolutePosition(anchorVisualCenter(anchor))
    // The arrow glyph is an orientation cue, not part of the annotation geometry. Keep it
    // upright while its center follows the transformer-relative handle.
    icon.rotation(0)
    icon.visible(true)
  }, [iconRef, transformerRef])

  const syncRotateAnchor = useCallback(() => {
    const transformer = transformerRef.current
    if (!transformer || transformer.nodes().length === 0) {
      syncRotateIcon()
      return
    }
    const anchor = transformer.findOne('.rotater')
    if (!anchor) {
      syncRotateIcon()
      return
    }

    const height = transformer.height()
    const currentSelection = selectionBox(transformer)
    const bounds = stageBounds(stageRef.current)
    if (!currentSelection) {
      syncRotateIcon()
      return
    }
    const chosen = resolveRotateSide(currentSelection, bounds, lockedSide.current)
    const offset = rotateAnchorOffset(height, transformer.padding(), chosen)
    if (Math.abs(transformer.rotateAnchorOffset() - offset) >= 0.5) {
      transformer.rotateAnchorOffset(offset)
      transformer.forceUpdate()
    }
    // Moving the anchor's offset while Konva is calculating a rotation changes the pointer
    // reference it captured on mousedown and can make the annotation jump. Clamp only before
    // the next gesture and after the committed geometry is available.
    if (!transformActive.current && bounds) keepAnchorInsideStage(anchor, bounds)
    syncRotateIcon()
    transformer.getLayer()?.batchDraw()
  }, [stageRef, syncRotateIcon, transformerRef])

  const beginTransform = useCallback(() => {
    if (transformActive.current) return
    transformActive.current = true
    const transformer = transformerRef.current
    const currentSelection = transformer ? selectionBox(transformer) : null
    lockedSide.current = currentSelection
      ? resolveRotateSide(currentSelection, stageBounds(stageRef.current), null)
      : null
  }, [stageRef, transformerRef])

  const endTransform = useCallback(() => {
    transformActive.current = false
    // syncRotateAnchor reads the committed node geometry and therefore chooses from the
    // screen-space bounds after the gesture, then clamps the reachable target if needed.
    lockedSide.current = null
    syncRotateAnchor()
  }, [syncRotateAnchor])

  const scheduleRotateAnchorSync = useCallback(() => {
    if (rotateSyncFrame.current !== null) return
    rotateSyncFrame.current = window.requestAnimationFrame(() => {
      rotateSyncFrame.current = null
      syncRotateAnchor()
    })
  }, [syncRotateAnchor])

  const styleTransformerAnchor = useCallback((anchor: Konva.Rect) => {
    if (!anchor.hasName('rotater')) return

    // Keep a larger, transparent drag target. The visible glyph is a separate Konva group
    // so it cannot be clipped by a fill pattern or intercept the anchor's drag events.
    anchor.size({ width: ROTATE_ICON_SIZE, height: ROTATE_ICON_SIZE })
    anchor.offset({ x: ROTATE_ICON_SIZE / 2, y: ROTATE_ICON_SIZE / 2 })
    anchor.cornerRadius(ROTATE_ICON_SIZE / 2)
    anchor.stroke('transparent')
    anchor.strokeWidth(0)
    anchor.fillPriority('color')
    anchor.fill('transparent')
  }, [])

  useEffect(() => {
    return () => {
      if (rotateSyncFrame.current !== null) {
        window.cancelAnimationFrame(rotateSyncFrame.current)
        rotateSyncFrame.current = null
      }
    }
  }, [])

  return {
    beginTransform,
    endTransform,
    syncRotateAnchor,
    scheduleRotateAnchorSync,
    styleTransformerAnchor
  }
}
