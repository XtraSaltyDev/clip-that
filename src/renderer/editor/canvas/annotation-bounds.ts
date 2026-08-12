import type {
  AnnotationInsets,
  ArrowShape,
  BoxShape,
  ClipDocument,
  Shape,
  TextShape
} from '@shared/types'
import { computeLayout, type Layout } from '../layout'
import {
  effectiveLinePoints,
  lineEndpoint,
  measurementLabelLayout,
  pointsCenter,
  renderedLinePoints,
  sampledEllipseBoundary,
  sampledRoundedRectBoundary,
  sampledTensionPath,
  transformAround,
  type DragRect,
  type Point
} from './geometry'

/** Extra output pixels kept around an annotation so a stroke never kisses the capture edge. */
export const ANNOTATION_EXPANSION_MARGIN = 16
export const MAX_ANNOTATION_INSET = 4_096

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function normalizedInsets(value: AnnotationInsets | undefined): AnnotationInsets {
  return {
    top: Math.min(MAX_ANNOTATION_INSET, Math.max(0, finite(value?.top ?? 0))),
    right: Math.min(MAX_ANNOTATION_INSET, Math.max(0, finite(value?.right ?? 0))),
    bottom: Math.min(MAX_ANNOTATION_INSET, Math.max(0, finite(value?.bottom ?? 0))),
    left: Math.min(MAX_ANNOTATION_INSET, Math.max(0, finite(value?.left ?? 0)))
  }
}

function boundsOf(points: Point[]): DragRect | null {
  const finitePoints = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
  )
  if (finitePoints.length === 0) return null
  return {
    left: Math.min(...finitePoints.map((point) => point.x)),
    top: Math.min(...finitePoints.map((point) => point.y)),
    right: Math.max(...finitePoints.map((point) => point.x)),
    bottom: Math.max(...finitePoints.map((point) => point.y))
  }
}

function expand(bounds: DragRect, amount: number): DragRect {
  const value = Math.max(0, finite(amount))
  return {
    left: bounds.left - value,
    top: bounds.top - value,
    right: bounds.right + value,
    bottom: bounds.bottom + value
  }
}

function union(a: DragRect | null, b: DragRect | null): DragRect | null {
  if (!a) return b
  if (!b) return a
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom)
  }
}

function clipPoints(points: Point[], shape: Shape): Point[] {
  const clips = shape.clipRects
  if (!clips || clips.length === 0) return points
  return points.filter((point) =>
    clips.some(
      (clip) =>
        point.x >= clip.x &&
        point.x <= clip.x + clip.width &&
        point.y >= clip.y &&
        point.y <= clip.y + clip.height
    )
  )
}

function shadowExtent(shape: Shape): { left: number; top: number; right: number; bottom: number } {
  const hasShadow = 'shadow' in shape && shape.shadow
  if (!hasShadow && shape.type !== 'magnify') {
    return { left: 0, top: 0, right: 0, bottom: 0 }
  }
  const blur = shape.type === 'magnify' ? 14 : Math.max(0, shape.shadowBlur ?? 6)
  const offsetX = shape.type === 'magnify' ? 0 : (shape.shadowOffsetX ?? 0)
  const offsetY = shape.type === 'magnify' ? 0 : (shape.shadowOffsetY ?? 2)
  return {
    left: blur + Math.max(0, -offsetX),
    top: blur + Math.max(0, -offsetY),
    right: blur + Math.max(0, offsetX),
    bottom: blur + Math.max(0, offsetY)
  }
}

function withStrokeAndShadow(
  shape: Shape,
  points: Point[],
  strokeWidth: number,
  extraPoints: Point[] = []
): DragRect | null {
  const visiblePoints = clipPoints([...points, ...extraPoints], shape)
  const raw = boundsOf(visiblePoints)
  if (!raw) return null
  const stroked = expand(raw, Math.abs(finite(strokeWidth)) / 2)
  const shadow = shadowExtent(shape)
  return {
    left: stroked.left - shadow.left,
    top: stroked.top - shadow.top,
    right: stroked.right + shadow.right,
    bottom: stroked.bottom + shadow.bottom
  }
}

function arrowHeadPoints(shape: ArrowShape, pathPoints: Point[]): Point[] {
  const size = Math.abs(shape.strokeWidth) * (shape.headScale ?? 3)
  if (!Number.isFinite(size) || size <= 0 || pathPoints.length < 2) return []
  const width = size * 0.8
  const output: Point[] = []
  const append = (tip: Point, from: Point): void => {
    const dx = tip.x - from.x
    const dy = tip.y - from.y
    const length = Math.hypot(dx, dy)
    if (length < 0.0001) return
    const ux = dx / length
    const uy = dy / length
    const base = { x: tip.x - ux * size, y: tip.y - uy * size }
    const normal = { x: (-uy * width) / 2, y: (ux * width) / 2 }
    output.push(
      tip,
      { x: base.x + normal.x, y: base.y + normal.y },
      { x: base.x - normal.x, y: base.y - normal.y }
    )
  }
  if (shape.type !== 'line' && shape.endHead !== false)
    append(pathPoints[pathPoints.length - 1], pathPoints[pathPoints.length - 2])
  if (shape.startHead) append(pathPoints[0], pathPoints[1])
  return output
}

function linePaintedBounds(shape: ArrowShape): DragRect | null {
  const points = effectiveLinePoints(shape)
  const rendered = renderedLinePoints(points, shape.curve)
  const path = sampledTensionPath(rendered.points, rendered.tension, 4)
  const heads = arrowHeadPoints(shape, path)
  let bounds = withStrokeAndShadow(shape, path, shape.strokeWidth, heads)
  if (shape.type === 'measure' && points.length >= 4) {
    const start = lineEndpoint(points, 'start')
    const end = lineEndpoint(points, 'end')
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    const labelText = `${Math.round(Math.hypot(end.x - start.x, end.y - start.y))} px`
    const labelFontSize = Math.max(12, shape.strokeWidth * 3.5)
    const label = measurementLabelLayout(
      points,
      labelFontSize,
      shape.strokeWidth,
      Math.abs(shape.strokeWidth * (shape.headScale ?? 3)),
      Math.max(80, labelText.length * labelFontSize * 0.62),
      4,
      shape.curve
    )
    bounds = union(bounds, {
      left: midpoint.x + label.x,
      top: midpoint.y + label.y,
      right: midpoint.x + label.x + label.width,
      bottom: midpoint.y + label.y + label.height
    })
  }
  return bounds
}

function boxPoints(shape: BoxShape): Point[] {
  const width = Math.abs(shape.width)
  const height = Math.abs(shape.height)
  const left = shape.width < 0 ? shape.x - width : shape.x
  const top = shape.height < 0 ? shape.y - height : shape.y
  const boundary = sampledRoundedRectBoundary(left, top, width, height, shape.cornerRadius, 4)
  const points = shape.fill ? [...boundary, { x: left + width / 2, y: top + height / 2 }] : boundary
  return transformAround(points, { x: left, y: top }, shape.rotation)
}

function ellipsePoints(shape: BoxShape): Point[] {
  const width = Math.abs(shape.width)
  const height = Math.abs(shape.height)
  const center = {
    x: (shape.width < 0 ? shape.x - width : shape.x) + width / 2,
    y: (shape.height < 0 ? shape.y - height : shape.y) + height / 2
  }
  const points = sampledEllipseBoundary(center, width / 2, height / 2, 4)
  if (shape.fill) points.push(center)
  return transformAround(points, center, shape.rotation)
}

function calloutPoints(shape: TextShape): Point[] {
  const height = shape.height ?? 80
  const tail = shape.tail ?? { x: shape.width / 2, y: height + 40 }
  const cx = shape.width / 2
  const cy = height / 2
  const dx = tail.x - cx
  const dy = tail.y - cy
  const horizontal = Math.abs(dx) / (shape.width || 1) > Math.abs(dy) / (height || 1)
  const spread = Math.min(22, (horizontal ? height : shape.width) * 0.3)
  const anchor = horizontal
    ? dx > 0
      ? [
          { x: shape.width, y: cy - spread },
          { x: shape.width, y: cy + spread }
        ]
      : [
          { x: 0, y: cy - spread },
          { x: 0, y: cy + spread }
        ]
    : dy > 0
      ? [
          { x: cx - spread, y: height },
          { x: cx + spread, y: height }
        ]
      : [
          { x: cx - spread, y: 0 },
          { x: cx + spread, y: 0 }
        ]
  const local = [
    ...sampledRoundedRectBoundary(0, 0, shape.width, height, shape.cornerRadius ?? 10, 4),
    ...anchor,
    { x: tail.x, y: tail.y }
  ]
  return transformAround(
    local.map((point) => ({ x: point.x + shape.x, y: point.y + shape.y })),
    { x: shape.x, y: shape.y },
    shape.rotation
  )
}

/**
 * Bounds of pixels intentionally painted by an annotation. Unlike interactiveRecoveryRects,
 * this never includes invisible hit padding, Transformer controls, or the HTML toolbar.
 */
export function annotationPaintedBounds(shape: Shape): DragRect | null {
  switch (shape.type) {
    case 'arrow':
    case 'line':
    case 'measure':
      return linePaintedBounds(shape)
    case 'pen':
    case 'highlighter': {
      const center = pointsCenter(shape.points)
      const points = transformAround(
        sampledTensionPath(shape.points, 0.4, 4),
        center,
        shape.rotation
      )
      return withStrokeAndShadow(shape, points, shape.strokeWidth)
    }
    case 'rect':
    case 'blur':
    case 'pixelate':
    case 'redact':
    case 'magnify': {
      const box = shape as BoxShape
      return withStrokeAndShadow(box, boxPoints(box), box.strokeWidth ?? 0)
    }
    case 'ellipse': {
      const ellipse = shape as BoxShape
      return withStrokeAndShadow(ellipse, ellipsePoints(ellipse), ellipse.strokeWidth ?? 0)
    }
    case 'spotlight': {
      const spotlight = shape as BoxShape
      // The full-canvas dim bands are presentation over the capture, not movable annotation
      // pixels. The selected hole/outline is the recoverable and expandable body.
      const width = Math.abs(spotlight.width)
      const height = Math.abs(spotlight.height)
      const left = spotlight.width < 0 ? spotlight.x - width : spotlight.x
      const top = spotlight.height < 0 ? spotlight.y - height : spotlight.y
      const points = transformAround(
        sampledRoundedRectBoundary(left, top, width, height, spotlight.cornerRadius, 4),
        { x: 0, y: 0 },
        spotlight.rotation
      )
      return withStrokeAndShadow(spotlight, points, spotlight.strokeWidth ?? 0)
    }
    case 'text': {
      const text = shape as TextShape
      const height = text.height ?? Math.max(1, text.fontSize * 1.4)
      const points = transformAround(
        sampledRoundedRectBoundary(text.x, text.y, text.width, height, text.cornerRadius, 4),
        { x: text.x, y: text.y },
        text.rotation
      )
      return withStrokeAndShadow(text, points, text.strokeWidth ?? 0)
    }
    case 'callout':
      return withStrokeAndShadow(
        shape,
        calloutPoints(shape as TextShape),
        (shape as TextShape).strokeWidth ?? 0
      )
    case 'step': {
      const radius = shape.radius * (shape.shape === 'diamond' ? 1.25 : 1)
      const points = sampledEllipseBoundary({ x: shape.x, y: shape.y }, radius, radius, 4)
      return withStrokeAndShadow(
        shape,
        transformAround(points, { x: shape.x, y: shape.y }, shape.rotation),
        0
      )
    }
    default:
      return null
  }
}

function sameInsets(a: AnnotationInsets, b: AnnotationInsets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left
}

/**
 * Compute expand-only automatic workspace from painted annotation bounds. The base layout is
 * recomputed with automatic insets removed so manual padding/aspect space is not counted twice.
 */
export function expandedAnnotationInsets(
  doc: ClipDocument,
  layout: Layout = computeLayout(doc),
  shapes: Shape[] = doc.shapes
): AnnotationInsets {
  const current = normalizedInsets(doc.canvas.annotationInsets)
  const baseDoc: ClipDocument = {
    ...doc,
    canvas: { ...doc.canvas, annotationInsets: undefined }
  }
  const base = computeLayout(baseDoc)
  const leftAvailable = base.shotX
  const rightAvailable = base.canvasWidth - base.shotX - layout.contentWidth
  const topAvailable = base.shotY + base.frameHeight
  const bottomAvailable = base.canvasHeight - (base.shotY + base.frameHeight) - layout.contentHeight
  let next = { ...current }

  for (const shape of shapes) {
    if (shape.hidden) continue
    const painted = annotationPaintedBounds(shape)
    if (!painted) continue
    const left = painted.left - layout.cropX
    const right = painted.right - layout.cropX
    const top = painted.top - layout.cropY
    const bottom = painted.bottom - layout.cropY
    const leftNeeded = Math.max(0, Math.ceil(ANNOTATION_EXPANSION_MARGIN - left - leftAvailable))
    const rightNeeded = Math.max(
      0,
      Math.ceil(right - layout.contentWidth - rightAvailable + ANNOTATION_EXPANSION_MARGIN)
    )
    const topNeeded = Math.max(0, Math.ceil(ANNOTATION_EXPANSION_MARGIN - top - topAvailable))
    const bottomNeeded = Math.max(
      0,
      Math.ceil(bottom - layout.contentHeight - bottomAvailable + ANNOTATION_EXPANSION_MARGIN)
    )
    next = {
      left: Math.min(MAX_ANNOTATION_INSET, Math.max(next.left, leftNeeded)),
      right: Math.min(MAX_ANNOTATION_INSET, Math.max(next.right, rightNeeded)),
      top: Math.min(MAX_ANNOTATION_INSET, Math.max(next.top, topNeeded)),
      bottom: Math.min(MAX_ANNOTATION_INSET, Math.max(next.bottom, bottomNeeded))
    }
  }
  return sameInsets(current, next) ? current : next
}

export function needsAnnotationExpansion(doc: ClipDocument, layout?: Layout): boolean {
  const current = normalizedInsets(doc.canvas.annotationInsets)
  return !sameInsets(current, expandedAnnotationInsets(doc, layout))
}
