import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type Konva from 'konva'
import {
  chooseRotateSide,
  clampRotateCenter,
  oppositeRotateSide,
  rectOverflow,
  rotateAnchorOffset,
  ROTATE_ICON_SIZE
} from './rotation-handle'
import type { RotateBounds } from './rotation-handle'

export interface RotateHandleRefs {
  stageRef: MutableRefObject<Konva.Stage | null>
  transformerRef: MutableRefObject<Konva.Transformer | null>
  iconRef: MutableRefObject<Konva.Group | null>
}

export interface RotateHandleActions {
  syncRotateAnchor: () => void
  scheduleRotateAnchorSync: () => void
  styleTransformerAnchor: (anchor: Konva.Rect) => void
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
    const selectedNode = transformer.nodes()[0]
    icon.rotation(selectedNode?.getAbsoluteRotation() ?? transformer.rotation())
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
    const selection = transformer.nodes().reduce(
      (bounds, node) => {
        const rect = node.getClientRect()
        return {
          x: Math.min(bounds.x, rect.x),
          y: Math.min(bounds.y, rect.y),
          right: Math.max(bounds.right, rect.x + rect.width),
          bottom: Math.max(bounds.bottom, rect.y + rect.height)
        }
      },
      {
        x: Number.POSITIVE_INFINITY,
        y: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY
      }
    )
    const stage = stageRef.current?.getClientRect()
    const selectionBox = {
      left: selection.x,
      top: selection.y,
      width: selection.right - selection.x,
      height: selection.bottom - selection.y
    }
    const stageBounds = stage
      ? {
          left: stage.x,
          top: stage.y,
          right: stage.x + stage.width,
          bottom: stage.y + stage.height
        }
      : undefined
    const preferred = chooseRotateSide(selectionBox, stageBounds)
    const candidates = [preferred, oppositeRotateSide(preferred)]

    let chosen = preferred
    let bestOverflow = Number.POSITIVE_INFINITY
    for (const side of candidates) {
      transformer.rotateAnchorOffset(rotateAnchorOffset(height, transformer.padding(), side))
      transformer.forceUpdate()
      const position = anchorVisualCenter(anchor)
      const overflow = stageBounds
        ? rectOverflow(
            {
              left: position.x - ROTATE_ICON_SIZE / 2,
              top: position.y - ROTATE_ICON_SIZE / 2,
              width: ROTATE_ICON_SIZE,
              height: ROTATE_ICON_SIZE
            },
            stageBounds
          )
        : 0
      if (overflow < bestOverflow) {
        chosen = side
        bestOverflow = overflow
      }
      if (overflow === 0) break
    }

    const offset = rotateAnchorOffset(height, transformer.padding(), chosen)
    if (Math.abs(transformer.rotateAnchorOffset() - offset) >= 0.5) {
      transformer.rotateAnchorOffset(offset)
      transformer.forceUpdate()
    }
    if (stageBounds) keepAnchorInsideStage(anchor, stageBounds)
    syncRotateIcon()
    transformer.getLayer()?.batchDraw()
  }, [stageRef, syncRotateIcon, transformerRef])

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

  return { syncRotateAnchor, scheduleRotateAnchorSync, styleTransformerAnchor }
}
