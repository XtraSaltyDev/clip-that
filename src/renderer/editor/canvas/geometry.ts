import type {
  ArrowShape,
  BoxShape,
  FreehandShape,
  Shape,
  StepShape,
  TextShape
} from '@shared/types'

export function pointsCenter(points: number[]): { x: number; y: number } {
  if (points.length < 2) return { x: 0, y: 0 }

  let minX = points[0]
  let maxX = points[0]
  let minY = points[1]
  let maxY = points[1]
  for (let i = 2; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i])
    maxX = Math.max(maxX, points[i])
    minY = Math.min(minY, points[i + 1])
    maxY = Math.max(maxY, points[i + 1])
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

export interface Point {
  x: number
  y: number
}

export type LineEndpoint = 'start' | 'end'

const LINE_LIKE_TYPES = new Set(['arrow', 'line', 'measure'])
const EPSILON = 0.0001
export const DIRECT_HANDLE_RADIUS_SCREEN = 6
export const DIRECT_HANDLE_HIT_DIAMETER_SCREEN = 24
export const MEASUREMENT_HIT_DIAMETER_SCREEN = 28
export const BODY_HIT_DIAMETER_SCREEN = 24
export const BODY_DRAG_VISIBILITY_MARGIN_SCREEN = 24

export interface DragRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface DragBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface DragGuide {
  x?: number
  y?: number
}

export interface MeasurementLabelLayout {
  x: number
  y: number
  width: number
  height: number
  normal: Point
  offset: number
}

/** True for the annotation families whose direction is defined by a point list. */
export function isLineLikeShape(shape: Shape): shape is ArrowShape {
  return LINE_LIKE_TYPES.has(shape.type) && 'points' in shape
}

/**
 * Direct endpoint editing is intentionally limited to a single segment. Cut Out may create
 * longer split polylines, and those retain the generic Transformer so no intermediate point
 * can be lost accidentally.
 */
export function isDirectLineShape(shape: Shape): shape is ArrowShape {
  return (
    isLineLikeShape(shape) &&
    shape.points.length === 4 &&
    shape.points.every((value) => Number.isFinite(value))
  )
}

export function isInteractiveDirectLineShape(shape: Shape): shape is ArrowShape {
  return isDirectLineShape(shape) && !shape.locked && !shape.hidden
}

export function directHandleMetrics(zoom: number): {
  radius: number
  hitStrokeWidth: number
} {
  const scale = Math.max(zoom, 0.05)
  return {
    radius: DIRECT_HANDLE_RADIUS_SCREEN / scale,
    hitStrokeWidth: DIRECT_HANDLE_HIT_DIAMETER_SCREEN / scale
  }
}

/** Keep a thin measurement line easy to acquire in screen pixels at every zoom. */
export function measurementHitStrokeWidth(zoom: number, strokeWidth: number): number {
  const scale = Math.max(zoom, 0.05)
  return Math.max(Math.abs(strokeWidth), MEASUREMENT_HIT_DIAMETER_SCREEN / scale)
}

/** Hit width for body strokes, kept large enough to acquire at every editor zoom. */
export function interactiveHitStrokeWidth(zoom: number, strokeWidth: number): number {
  const scale = Math.max(zoom, 0.05)
  return Math.max(Math.abs(strokeWidth), BODY_HIT_DIAMETER_SCREEN / scale)
}

export function rotatePoint(point: Point, center: Point, degrees: number): Point {
  if (!degrees) return { ...point }
  const angle = (degrees * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  }
}

/**
 * Return the world-space point list that the existing renderer produces for a legacy rotated
 * line-like shape. Reading this is pure: opening a document never normalizes its stored data.
 */
export function effectiveLinePoints(shape: Pick<ArrowShape, 'points' | 'rotation'>): number[] {
  const points = [...shape.points]
  const rotation = shape.rotation ?? 0
  if (!rotation || points.length < 2) return points

  const center = pointsCenter(points)
  const effective: number[] = []
  for (let index = 0; index + 1 < points.length; index += 2) {
    const point = rotatePoint({ x: points[index], y: points[index + 1] }, center, rotation)
    effective.push(point.x, point.y)
  }
  return effective
}

export function lineEndpoint(points: number[], endpoint: LineEndpoint): Point {
  const index = endpoint === 'start' ? 0 : Math.max(0, points.length - 2)
  return { x: points[index] ?? 0, y: points[index + 1] ?? 0 }
}

export function lineLength(points: number[]): number {
  const start = lineEndpoint(points, 'start')
  const end = lineEndpoint(points, 'end')
  return Math.hypot(end.x - start.x, end.y - start.y)
}

export function replaceLineEndpoint(
  points: number[],
  endpoint: LineEndpoint,
  point: Point
): number[] {
  const next = [...points]
  const index = endpoint === 'start' ? 0 : Math.max(0, next.length - 2)
  if (next.length < 2) return [point.x, point.y]
  next[index] = point.x
  next[index + 1] = point.y
  return next
}

export function translatePoints(points: number[], dx: number, dy: number): number[] {
  return points.map((value, index) => value + (index % 2 === 0 ? dx : dy))
}

/** Translate any ordinary body shape without normalizing its stored rotation representation. */
export function bodyTranslationPatch(shape: Shape, dx: number, dy: number): Partial<Shape> {
  if ('points' in shape) {
    return { points: translatePoints(shape.points, dx, dy) } as Partial<Shape>
  }
  if ('x' in shape && 'y' in shape) {
    return { x: shape.x + dx, y: shape.y + dy } as Partial<Shape>
  }
  return {}
}

/** Bounds for the selectable line path, including its invisible screen-sized hit stroke. */
export function lineBodyBounds(
  points: number[],
  strokeWidth: number,
  curve = 0,
  arrowThickness = 0
): DragRect {
  const rendered = renderedLinePoints(points, curve)
  const candidates = sampledTensionPath(
    rendered.points,
    rendered.tension,
    Math.max(0.25, Math.max(Math.abs(strokeWidth), Math.abs(arrowThickness)) / 2)
  )
  if (candidates.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 }
  const halfStroke = Math.max(Math.abs(strokeWidth), Math.abs(arrowThickness)) / 2
  return {
    left: Math.min(...candidates.map((point) => point.x)) - halfStroke,
    top: Math.min(...candidates.map((point) => point.y)) - halfStroke,
    right: Math.max(...candidates.map((point) => point.x)) + halfStroke,
    bottom: Math.max(...candidates.map((point) => point.y)) + halfStroke
  }
}

const RECOVERY_SAMPLES = 16

interface TensionPathSegment {
  kind: 'line' | 'quadratic' | 'cubic'
  start: Point
  end: Point
  control?: Point
  control1?: Point
  control2?: Point
}

function pointRect(point: Point, radius: number): DragRect {
  const safeRadius = Math.max(0.5, Number.isFinite(radius) ? Math.abs(radius) : 0.5)
  return {
    left: point.x - safeRadius,
    top: point.y - safeRadius,
    right: point.x + safeRadius,
    bottom: point.y + safeRadius
  }
}

function appendSegmentSamples(target: Point[], start: Point, end: Point, count = 4): void {
  for (let index = 0; index <= count; index += 1) {
    const t = index / count
    target.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t
    })
  }
}

function finitePointPairs(points: number[]): Point[] {
  const values: Point[] = []
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = points[index]
    const y = points[index + 1]
    if (Number.isFinite(x) && Number.isFinite(y)) values.push({ x, y })
  }
  return values
}

function lineSegments(points: Point[]): TensionPathSegment[] {
  return points.slice(1).map((end, index) => ({ kind: 'line', start: points[index], end }))
}

/** The small control-point routine mirrored from Konva's open Line implementation. */
function tensionControlPoints(
  start: Point,
  middle: Point,
  end: Point,
  tension: number
): {
  before: Point
  after: Point
} | null {
  const d01 = Math.hypot(middle.x - start.x, middle.y - start.y)
  const d12 = Math.hypot(end.x - middle.x, end.y - middle.y)
  const denominator = d01 + d12
  if (denominator < EPSILON) return null
  const fa = (tension * d01) / denominator
  const fb = (tension * d12) / denominator
  return {
    before: {
      x: middle.x - fa * (end.x - start.x),
      y: middle.y - fa * (end.y - start.y)
    },
    after: {
      x: middle.x + fb * (end.x - start.x),
      y: middle.y + fb * (end.y - start.y)
    }
  }
}

/**
 * Reproduce Konva Line's open tension path: a quadratic into each first/last interior point and
 * cubic sections between the remaining interior points. Degenerate control triples fall back to
 * straight segments rather than introducing NaN recovery geometry.
 */
function tensionPathSegments(points: number[], tension: number): TensionPathSegment[] {
  const values = finitePointPairs(points)
  if (values.length < 2 || tension === 0 || values.length < 3) return lineSegments(values)

  const controls = []
  for (let index = 1; index < values.length - 1; index += 1) {
    const control = tensionControlPoints(
      values[index - 1],
      values[index],
      values[index + 1],
      tension
    )
    if (!control) return lineSegments(values)
    controls.push(control)
  }

  const segments: TensionPathSegment[] = [
    {
      kind: 'quadratic',
      start: values[0],
      control: controls[0].before,
      end: values[1]
    }
  ]
  for (let index = 1; index < controls.length; index += 1) {
    segments.push({
      kind: 'cubic',
      start: values[index],
      control1: controls[index - 1].after,
      control2: controls[index].before,
      end: values[index + 1]
    })
  }
  segments.push({
    kind: 'quadratic',
    start: values[values.length - 2],
    control: controls[controls.length - 1].after,
    end: values[values.length - 1]
  })
  return segments
}

function curvePoint(segment: TensionPathSegment, t: number): Point {
  const inverse = 1 - t
  if (segment.kind === 'line') {
    return {
      x: inverse * segment.start.x + t * segment.end.x,
      y: inverse * segment.start.y + t * segment.end.y
    }
  }
  if (segment.kind === 'quadratic') {
    const control = segment.control as Point
    return {
      x: inverse * inverse * segment.start.x + 2 * inverse * t * control.x + t * t * segment.end.x,
      y: inverse * inverse * segment.start.y + 2 * inverse * t * control.y + t * t * segment.end.y
    }
  }
  const control1 = segment.control1 as Point
  const control2 = segment.control2 as Point
  return {
    x:
      inverse ** 3 * segment.start.x +
      3 * inverse ** 2 * t * control1.x +
      3 * inverse * t * t * control2.x +
      t ** 3 * segment.end.x,
    y:
      inverse ** 3 * segment.start.y +
      3 * inverse ** 2 * t * control1.y +
      3 * inverse * t * t * control2.y +
      t ** 3 * segment.end.y
  }
}

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function pointLineDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < EPSILON * EPSILON) return pointDistance(point, start)
  return (
    Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) /
    Math.sqrt(lengthSquared)
  )
}

function appendAdaptiveCurveSamples(
  target: Point[],
  segment: TensionPathSegment,
  maxStep: number
): void {
  const start = segment.start
  const end = segment.end
  if (target.length === 0 || pointDistance(target[target.length - 1], start) > EPSILON) {
    target.push({ ...start })
  }

  const visit = (t0: number, p0: Point, t1: number, p1: Point, depth: number): void => {
    const middleT = (t0 + t1) / 2
    const middle = curvePoint(segment, middleT)
    const quarter = curvePoint(segment, t0 + (t1 - t0) * 0.25)
    const threeQuarter = curvePoint(segment, t0 + (t1 - t0) * 0.75)
    const chord = pointDistance(p0, p1)
    const flatness = Math.max(
      pointLineDistance(quarter, p0, p1),
      pointLineDistance(middle, p0, p1),
      pointLineDistance(threeQuarter, p0, p1)
    )
    if (depth >= 24 || (chord <= maxStep && flatness <= maxStep)) {
      target.push({ ...p1 })
      return
    }
    visit(t0, p0, middleT, middle, depth + 1)
    visit(middleT, middle, t1, p1, depth + 1)
  }

  visit(0, start, 1, end, 0)
}

/**
 * Sample the same line/tension path Konva paints. maxStep is in canvas units. Recovery callers
 * use half of their hit radius so every rendered path location stays within the actual hit
 * radius of a retained candidate, including very large or sharply bent paths.
 */
export function sampledTensionPath(points: number[], tension = 0, maxStep = 8): Point[] {
  const segments = tensionPathSegments(points, tension)
  const safeStep = Math.max(0.01, Number.isFinite(maxStep) ? Math.abs(maxStep) : 8)
  const samples: Point[] = []
  if (segments.length === 0) {
    const first = finitePointPairs(points)[0]
    return first ? [{ ...first }] : []
  }
  for (const segment of segments) appendAdaptiveCurveSamples(samples, segment, safeStep)
  return samples
}

export function renderedLinePoints(
  points: number[],
  curve = 0
): { points: number[]; tension: number } {
  if (points.length === 4 && Number.isFinite(curve) && Math.abs(curve) >= EPSILON) {
    const start = lineEndpoint(points, 'start')
    const end = lineEndpoint(points, 'end')
    const control = lineCurvePoint(points, curve)
    return {
      points: [start.x, start.y, control.x, control.y, end.x, end.y],
      tension: 0.4
    }
  }
  return { points: [...points], tension: curve !== 0 ? 0.4 : 0 }
}

function sampledLinePoints(points: number[], tension = 0, maxStep = 8): Point[] {
  return sampledTensionPath(points, tension, maxStep)
}

function cornerRadiusValue(
  cornerRadius: number | undefined,
  width: number,
  height: number
): number {
  return Math.min(Math.max(0, cornerRadius ?? 0), width / 2, height / 2)
}

function appendArcSamples(
  target: Point[],
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  maxStep: number
): void {
  if (radius <= 0) {
    target.push({
      x: center.x + Math.cos(endAngle) * radius,
      y: center.y + Math.sin(endAngle) * radius
    })
    return
  }
  const count = Math.max(2, Math.ceil((Math.abs(endAngle - startAngle) * radius) / maxStep))
  for (let index = 0; index <= count; index += 1) {
    const angle = startAngle + ((endAngle - startAngle) * index) / count
    target.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius })
  }
}

export function sampledRoundedRectBoundary(
  left: number,
  top: number,
  width: number,
  height: number,
  cornerRadius = 0,
  maxStep = 8
): Point[] {
  const radius = cornerRadiusValue(cornerRadius, width, height)
  if (radius <= 0) {
    const values: Point[] = []
    const right = left + width
    const bottom = top + height
    const countX = Math.max(1, Math.ceil(width / maxStep))
    const countY = Math.max(1, Math.ceil(height / maxStep))
    appendSegmentSamples(values, { x: left, y: top }, { x: right, y: top }, countX)
    appendSegmentSamples(values, { x: right, y: top }, { x: right, y: bottom }, countY)
    appendSegmentSamples(values, { x: right, y: bottom }, { x: left, y: bottom }, countX)
    appendSegmentSamples(values, { x: left, y: bottom }, { x: left, y: top }, countY)
    return values
  }

  const right = left + width
  const bottom = top + height
  const values: Point[] = []
  const countX = Math.max(1, Math.ceil((width - radius * 2) / maxStep))
  const countY = Math.max(1, Math.ceil((height - radius * 2) / maxStep))
  appendSegmentSamples(values, { x: left + radius, y: top }, { x: right - radius, y: top }, countX)
  appendArcSamples(values, { x: right - radius, y: top + radius }, radius, -Math.PI / 2, 0, maxStep)
  appendSegmentSamples(
    values,
    { x: right, y: top + radius },
    { x: right, y: bottom - radius },
    countY
  )
  appendArcSamples(
    values,
    { x: right - radius, y: bottom - radius },
    radius,
    0,
    Math.PI / 2,
    maxStep
  )
  appendSegmentSamples(
    values,
    { x: right - radius, y: bottom },
    { x: left + radius, y: bottom },
    countX
  )
  appendArcSamples(
    values,
    { x: left + radius, y: bottom - radius },
    radius,
    Math.PI / 2,
    Math.PI,
    maxStep
  )
  appendSegmentSamples(
    values,
    { x: left, y: bottom - radius },
    { x: left, y: top + radius },
    countY
  )
  appendArcSamples(
    values,
    { x: left + radius, y: top + radius },
    radius,
    Math.PI,
    (Math.PI * 3) / 2,
    maxStep
  )
  return values
}

export function sampledEllipseBoundary(
  center: Point,
  radiusX: number,
  radiusY: number,
  maxStep = 8
): Point[] {
  const values: Point[] = []
  const circumferenceRadius = Math.max(Math.abs(radiusX), Math.abs(radiusY))
  const count = Math.max(
    RECOVERY_SAMPLES * 2,
    Math.ceil((Math.PI * 2 * circumferenceRadius) / Math.max(0.5, maxStep))
  )
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2
    values.push({
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY
    })
  }
  return values
}

export function transformAround(points: Point[], center: Point, rotation = 0): Point[] {
  return rotation ? points.map((point) => rotatePoint(point, center, rotation)) : points
}

function rectRecoveryRects(
  shape: Pick<
    BoxShape,
    'x' | 'y' | 'width' | 'height' | 'rotation' | 'strokeWidth' | 'fill' | 'cornerRadius'
  >,
  zoom: number,
  includeCenter: boolean,
  rotationCenter?: Point
): DragRect[] {
  const width = Math.abs(shape.width)
  const height = Math.abs(shape.height)
  const left = shape.width < 0 ? shape.x - width : shape.x
  const top = shape.height < 0 ? shape.y - height : shape.y
  const stroke = interactiveHitStrokeWidth(zoom, shape.strokeWidth)
  const center = rotationCenter ?? { x: left, y: top }
  const boundary = transformAround(
    sampledRoundedRectBoundary(
      left,
      top,
      width,
      height,
      shape.cornerRadius,
      Math.max(1, stroke / 2)
    ),
    center,
    shape.rotation
  )
  const points = includeCenter
    ? [
        ...boundary,
        ...transformAround([{ x: left + width / 2, y: top + height / 2 }], center, shape.rotation)
      ]
    : boundary
  return points.map((point) =>
    pointRect(point, includeCenter ? Math.max(1, stroke / 2) : stroke / 2)
  )
}

function ellipseRecoveryRects(
  shape: Pick<BoxShape, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'strokeWidth' | 'fill'>,
  zoom: number
): DragRect[] {
  const width = Math.abs(shape.width)
  const height = Math.abs(shape.height)
  const center = {
    x: (shape.width < 0 ? shape.x - width : shape.x) + width / 2,
    y: (shape.height < 0 ? shape.y - height : shape.y) + height / 2
  }
  const radius = interactiveHitStrokeWidth(zoom, shape.strokeWidth) / 2
  const points = transformAround(
    sampledEllipseBoundary(center, width / 2, height / 2, radius),
    center,
    shape.rotation
  )
  if (shape.fill) points.push(center)
  return points.map((point) => pointRect(point, radius))
}

function clippedRecoveryRects(rects: DragRect[], shape: Shape): DragRect[] {
  const clips = shape.clipRects
  if (!clips || clips.length === 0) return rects
  const clipped: DragRect[] = []
  for (const rect of rects) {
    for (const clip of clips) {
      const next = {
        left: Math.max(rect.left, clip.x),
        top: Math.max(rect.top, clip.y),
        right: Math.min(rect.right, clip.x + clip.width),
        bottom: Math.min(rect.bottom, clip.y + clip.height)
      }
      if (next.right >= next.left && next.bottom >= next.top) clipped.push(next)
    }
  }
  // If no sampled painted/hit point intersects a cut-out piece, the annotation has no
  // recoverable interactive geometry in that piece. Returning the clip rectangle would turn
  // empty pixels into a false body hit and let the clamp claim the object is recoverable.
  return clipped
}

/**
 * Return small rectangles centred on painted or deliberate hit geometry.
 *
 * A node client rectangle is only an AABB and can contain empty corners after rotation. These
 * candidates are the portions a user can actually reacquire: line samples, shape perimeters,
 * text/filled body points, or the transparent hit body used by composite regions.
 */
export function interactiveRecoveryRects(shape: Shape, zoom = 1): DragRect[] {
  let rects: DragRect[]
  switch (shape.type) {
    case 'arrow':
    case 'line':
    case 'measure': {
      const line = shape as ArrowShape
      const effective = effectiveLinePoints(line)
      const hitWidth =
        line.type === 'measure'
          ? measurementHitStrokeWidth(zoom, line.strokeWidth)
          : interactiveHitStrokeWidth(
              zoom,
              Math.max(line.strokeWidth, line.strokeWidth * (line.headScale ?? 3))
            )
      const rendered = renderedLinePoints(effective, line.curve)
      rects = sampledLinePoints(rendered.points, rendered.tension, hitWidth / 4).map((point) =>
        pointRect(point, hitWidth / 2)
      )
      break
    }
    case 'pen':
    case 'highlighter': {
      const freehand = shape as FreehandShape
      const center = pointsCenter(freehand.points)
      const hitWidth = interactiveHitStrokeWidth(zoom, freehand.strokeWidth)
      const points = transformAround(
        sampledLinePoints(freehand.points, 0.4, hitWidth / 4),
        center,
        freehand.rotation
      )
      rects = points.map((point) => pointRect(point, hitWidth / 2))
      break
    }
    case 'rect':
      rects = rectRecoveryRects(shape as BoxShape, zoom, Boolean(shape.fill))
      break
    case 'ellipse':
      rects = ellipseRecoveryRects(shape as BoxShape, zoom)
      break
    case 'blur':
    case 'pixelate':
    case 'redact':
    case 'magnify':
      rects = rectRecoveryRects(shape as BoxShape, zoom, true)
      break
    case 'spotlight':
      // Spotlight's draggable annotation rectangle is a child of a full-canvas group whose
      // rotation origin is (0, 0), not the rectangle's own top-left corner.
      rects = rectRecoveryRects(shape as BoxShape, zoom, true, { x: 0, y: 0 })
      break
    case 'text': {
      const text = shape as TextShape
      const height = text.height ?? Math.max(1, text.fontSize * 1.4)
      rects = rectRecoveryRects(
        { ...text, height, strokeWidth: text.strokeWidth ?? 0, fill: text.background },
        zoom,
        true
      )
      break
    }
    case 'callout': {
      const callout = shape as TextShape
      const height = callout.height ?? 80
      const tail = callout.tail ?? { x: callout.width / 2, y: height + 40 }
      const rotation = callout.rotation ?? 0
      const bodyPoints = sampledRoundedRectBoundary(
        callout.x,
        callout.y,
        callout.width,
        height,
        callout.cornerRadius ?? 10,
        Math.max(1, interactiveHitStrokeWidth(zoom, callout.strokeWidth ?? 0) / 2)
      )
      const tailPoints: Point[] = []
      appendSegmentSamples(
        tailPoints,
        { x: callout.x + callout.width / 2, y: callout.y + height / 2 },
        { x: callout.x + tail.x, y: callout.y + tail.y },
        6
      )
      const points = transformAround(
        [...bodyPoints, ...tailPoints],
        { x: callout.x, y: callout.y },
        rotation
      )
      points.push(
        rotatePoint(
          { x: callout.x + callout.width / 2, y: callout.y + height / 2 },
          { x: callout.x, y: callout.y },
          rotation
        )
      )
      rects = points.map((point) =>
        pointRect(point, interactiveHitStrokeWidth(zoom, callout.strokeWidth ?? 0) / 2)
      )
      break
    }
    case 'step': {
      const step = shape as StepShape
      const points = sampledEllipseBoundary(
        { x: step.x, y: step.y },
        step.radius,
        step.radius,
        Math.max(1, step.radius * 0.2)
      )
      rects = transformAround(points, { x: step.x, y: step.y }, step.rotation).map((point) =>
        pointRect(point, Math.max(1, step.radius * 0.2))
      )
      rects.push(pointRect({ x: step.x, y: step.y }, Math.max(1, step.radius * 0.4)))
      break
    }
    default:
      rects = []
  }
  return clippedRecoveryRects(rects, shape)
}

function lineNormal(points: number[]): Point | null {
  const start = lineEndpoint(points, 'start')
  const end = lineEndpoint(points, 'end')
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length < EPSILON) return null
  return { x: -(end.y - start.y) / length, y: (end.x - start.x) / length }
}

/**
 * Pick one stable, screen-upright side for measurement labels. Reversing the endpoints produces
 * the opposite mathematical normal, so canonicalize it to the upper side (and left on vertical
 * ties) before placing the label.
 */
export function canonicalLineNormal(points: number[]): Point | null {
  const normal = lineNormal(points)
  if (!normal) return null
  if (normal.y > EPSILON || (Math.abs(normal.y) <= EPSILON && normal.x > EPSILON)) {
    return { x: -normal.x, y: -normal.y }
  }
  return normal
}

/**
 * Place a measurement label's axis-aligned text box away from the actual line normal. The
 * projected half-size accounts for diagonal text boxes; stroke and arrow thickness provide the
 * remaining clearance. Zero-length lines return a finite, centered layout.
 */
export function measurementLabelLayout(
  points: number[],
  fontSize: number,
  strokeWidth: number,
  arrowThickness: number,
  labelWidth = 80,
  margin = 4,
  curve = 0
): MeasurementLabelLayout {
  const width = Math.max(1, labelWidth)
  const height = Math.max(1, fontSize)
  const directedNormal = canonicalLineNormal(points)
  const normal = directedNormal ?? { x: 0, y: -1 }
  if (!directedNormal) {
    return { x: -width / 2, y: -height / 2, width, height, normal, offset: 0 }
  }

  const projectedHalfSize = Math.abs(normal.x) * (width / 2) + Math.abs(normal.y) * (height / 2)
  const lineClearance = Math.max(Math.abs(strokeWidth), Math.abs(arrowThickness)) / 2
  const midpoint = {
    x: (lineEndpoint(points, 'start').x + lineEndpoint(points, 'end').x) / 2,
    y: (lineEndpoint(points, 'start').y + lineEndpoint(points, 'end').y) / 2
  }
  const pathPoints: Point[] = []
  for (let index = 0; index + 1 < points.length; index += 2) {
    pathPoints.push({ x: points[index], y: points[index + 1] })
  }
  if (pathPoints.length === 2 && Number.isFinite(curve) && Math.abs(curve) >= EPSILON) {
    pathPoints.splice(1, 0, lineCurvePoint(points, curve))
  }
  const pathProjection = Math.max(
    0,
    ...pathPoints.map(
      (point) => (point.x - midpoint.x) * normal.x + (point.y - midpoint.y) * normal.y
    )
  )
  const offset = pathProjection + projectedHalfSize + lineClearance + Math.max(0, margin)
  return {
    x: normal.x * offset - width / 2,
    y: normal.y * offset - height / 2,
    width,
    height,
    normal,
    offset
  }
}

function translationRange(
  start: number,
  end: number,
  min: number,
  max: number,
  margin: number
): { min: number; max: number } {
  const available = Math.max(0, max - min)
  const safeMargin = Math.min(Math.max(0, margin), available / 2)
  const firstVisible = min + safeMargin
  const lastVisible = max - safeMargin
  return { min: firstVisible - end, max: lastVisible - start }
}

function clampToRange(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2
  return Math.min(Math.max(value, min), max)
}

function recoveryRange(
  rect: DragRect,
  bounds: DragBounds,
  margin: number
): { minX: number; maxX: number; minY: number; maxY: number } {
  const x = translationRange(rect.left, rect.right, bounds.left, bounds.right, margin)
  const y = translationRange(rect.top, rect.bottom, bounds.top, bounds.bottom, margin)
  return { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max }
}

function recoveryRectVisible(
  rect: DragRect,
  translation: Point,
  bounds: DragBounds,
  margin: number
): boolean {
  const range = recoveryRange(rect, bounds, margin)
  return (
    translation.x >= range.minX &&
    translation.x <= range.maxX &&
    translation.y >= range.minY &&
    translation.y <= range.maxY
  )
}

function projectedDistance(translation: Point, desired: Point): number {
  return (translation.x - desired.x) ** 2 + (translation.y - desired.y) ** 2
}

/** Clamp a drag to one of the actual selectable body pieces. */
export function clampTranslationToRecoveryRects(
  rects: DragRect[],
  desired: Point,
  bounds: DragBounds,
  margin: number
): Point {
  if (
    rects.length === 0 ||
    rects.some((rect) => recoveryRectVisible(rect, desired, bounds, margin))
  ) {
    return desired
  }

  let best = desired
  let bestDistance = Infinity
  for (const rect of rects) {
    const range = recoveryRange(rect, bounds, margin)
    const candidate = {
      x: clampToRange(desired.x, range.minX, range.maxX),
      y: clampToRange(desired.y, range.minY, range.maxY)
    }
    const distance = projectedDistance(candidate, desired)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

interface TranslationWindow {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function intersectWindows(a: TranslationWindow, b: TranslationWindow): TranslationWindow | null {
  const next = {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minY: Math.max(a.minY, b.minY),
    maxY: Math.min(a.maxY, b.maxY)
  }
  return next.minX <= next.maxX && next.minY <= next.maxY ? next : null
}

function projectedWindow(window: TranslationWindow, desired: Point): Point {
  return {
    x: clampToRange(desired.x, window.minX, window.maxX),
    y: clampToRange(desired.y, window.minY, window.maxY)
  }
}

/**
 * Clamp one common translation while requiring every selected object to retain one real body
 * candidate. Each candidate is an OR choice for its object; the bounded search keeps those OR
 * choices while preserving one shared translation and relative spacing.
 */
export function clampCommonTranslationToRecoveryGroups(
  groups: DragRect[][],
  desired: Point,
  bounds: DragBounds,
  margin: number
): Point {
  if (
    groups.length === 0 ||
    groups.every((group) =>
      group.some((rect) => recoveryRectVisible(rect, desired, bounds, margin))
    )
  ) {
    return desired
  }

  let windows: TranslationWindow[] = [
    { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity }
  ]
  for (const group of groups) {
    const next: TranslationWindow[] = []
    for (const current of windows) {
      for (const rect of group) {
        const intersection = intersectWindows(current, recoveryRange(rect, bounds, margin))
        if (intersection) next.push(intersection)
      }
    }
    if (next.length === 0) {
      // A valid drag starts with every selected member recoverable. If a malformed or already
      // off-canvas document has no common window, stopping at the current position is safer than
      // moving a member farther away from its only selectable pixels.
      return { x: 0, y: 0 }
    }
    next.sort(
      (a, b) =>
        projectedDistance(projectedWindow(a, desired), desired) -
        projectedDistance(projectedWindow(b, desired), desired)
    )
    windows = next.slice(0, 256)
  }

  let best = projectedWindow(windows[0], desired)
  let bestDistance = projectedDistance(best, desired)
  for (const window of windows) {
    const candidate = projectedWindow(window, desired)
    const distance = projectedDistance(candidate, desired)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/**
 * Clamp one common translation so every body rectangle retains an interactive slice in bounds.
 * Applying this to each member separately would allow selected objects to drift apart.
 */
export function clampCommonTranslationToBounds(
  rects: DragRect[],
  desired: Point,
  bounds: DragBounds,
  margin: number
): Point {
  if (rects.length === 0) return desired

  let minX = -Infinity
  let maxX = Infinity
  let minY = -Infinity
  let maxY = Infinity
  for (const rect of rects) {
    const x = translationRange(rect.left, rect.right, bounds.left, bounds.right, margin)
    const y = translationRange(rect.top, rect.bottom, bounds.top, bounds.bottom, margin)
    minX = Math.max(minX, x.min)
    maxX = Math.min(maxX, x.max)
    minY = Math.max(minY, y.min)
    maxY = Math.min(maxY, y.max)
  }
  return {
    x: clampToRange(desired.x, minX, maxX),
    y: clampToRange(desired.y, minY, maxY)
  }
}

/** Return the smallest translation that keeps one dragged object visibly recoverable. */
export function clampTranslationToBounds(
  rect: DragRect,
  bounds: DragBounds,
  margin: number
): Point {
  return clampCommonTranslationToBounds([rect], { x: 0, y: 0 }, bounds, margin)
}

export interface ProvisionalMultiSelection {
  anchorId: string
  selectedIds: string[]
}

/** Preserve a multi-selection only provisionally until Konva reports a real body drag. */
export function beginProvisionalMultiSelection(
  selectedIds: string[],
  anchorId: string,
  additive: boolean
): ProvisionalMultiSelection | null {
  if (additive || selectedIds.length < 2 || !selectedIds.includes(anchorId)) return null
  return { anchorId, selectedIds: [...selectedIds] }
}

export function selectionAfterPointerDown(
  selectedIds: string[],
  id: string,
  additive: boolean,
  preserveProvisionalMulti: boolean
): string[] {
  if (preserveProvisionalMulti) return [...selectedIds]
  if (!additive) return [id]
  return selectedIds.includes(id)
    ? selectedIds.filter((selectedId) => selectedId !== id)
    : [...selectedIds, id]
}

export function finishProvisionalMultiSelection(
  pending: ProvisionalMultiSelection,
  didDrag: boolean
): string[] {
  return didDrag ? [...pending.selectedIds] : [pending.anchorId]
}

export interface BodyDragLeaveState {
  captured: boolean
  dragging: boolean
  collective: boolean
}

/** Keep Konva's global drag lifecycle alive after the pointer leaves the Stage. */
export function shouldContinueBodyDragAfterMouseLeave(state: BodyDragLeaveState): boolean {
  return state.captured && (state.dragging || state.collective)
}

export function translateDragRect(rect: DragRect, delta: Point): DragRect {
  return {
    left: rect.left + delta.x,
    top: rect.top + delta.y,
    right: rect.right + delta.x,
    bottom: rect.bottom + delta.y
  }
}

export function unionDragRects(rects: DragRect[]): DragRect | null {
  if (rects.length === 0) return null
  return rects.reduce(
    (union, rect) => ({
      left: Math.min(union.left, rect.left),
      top: Math.min(union.top, rect.top),
      right: Math.max(union.right, rect.right),
      bottom: Math.max(union.bottom, rect.bottom)
    }),
    { ...rects[0] }
  )
}

/** Snap a translated union box once, returning one shared delta and its guides. */
export function snapTranslationToLines(
  rect: DragRect,
  desired: Point,
  verticalLines: number[],
  horizontalLines: number[],
  threshold: number
): { translation: Point; guides: DragGuide[] } {
  let x = desired.x
  let y = desired.y
  const guides: DragGuide[] = []
  const translated = translateDragRect(rect, desired)
  for (const line of verticalLines) {
    for (const edge of [
      translated.left,
      (translated.left + translated.right) / 2,
      translated.right
    ]) {
      if (Math.abs(edge - line) < threshold) {
        x += line - edge
        guides.push({ x: line })
        break
      }
    }
    if (guides.some((guide) => guide.x !== undefined)) break
  }
  for (const line of horizontalLines) {
    for (const edge of [
      translated.top,
      (translated.top + translated.bottom) / 2,
      translated.bottom
    ]) {
      if (Math.abs(edge - line) < threshold) {
        y += line - edge
        guides.push({ y: line })
        break
      }
    }
    if (guides.some((guide) => guide.y !== undefined)) break
  }
  return { translation: { x, y }, guides }
}

/** The same midpoint-plus-perpendicular control point used by Shapes.tsx for curved lines. */
export function lineCurvePoint(points: number[], curve = 0): Point {
  const start = lineEndpoint(points, 'start')
  const end = lineEndpoint(points, 'end')
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const normal = lineNormal(points)
  return normal ? { x: midpoint.x + normal.x * curve, y: midpoint.y + normal.y * curve } : midpoint
}

/** Convert a world-space curve control point back into the stored perpendicular offset. */
export function lineCurveOffset(points: number[], control: Point): number {
  const start = lineEndpoint(points, 'start')
  const end = lineEndpoint(points, 'end')
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const normal = lineNormal(points)
  return normal ? (control.x - midpoint.x) * normal.x + (control.y - midpoint.y) * normal.y : 0
}

/**
 * Normalize a legacy line after a direct edit. The returned point list is world-space and the
 * rotation is explicit zero, which keeps serialization deterministic while leaving the input
 * object untouched for undo snapshots.
 */
export function normalizedLinePatch(shape: ArrowShape, points: number[]): Partial<ArrowShape> {
  return { points: [...points], rotation: 0 }
}

/** Replace one endpoint in effective world space and preserve a curved line's visual bow. */
export function endpointEditPatch(
  shape: ArrowShape,
  endpoint: LineEndpoint,
  point: Point
): Partial<ArrowShape> {
  const current = effectiveLinePoints(shape)
  const points = replaceLineEndpoint(current, endpoint, point)
  const patch: Partial<ArrowShape> = normalizedLinePatch(shape, points)
  // The curve is a perpendicular offset, not an independent world-space control point. Keep
  // its magnitude when an endpoint changes so a modest bow cannot become an extreme one merely
  // because the line crossed or changed direction.
  if (shape.curve !== undefined) patch.curve = shape.curve
  return patch
}

/** Translate a line in effective world space and bake any legacy rotation. */
export function bodyDragPatch(shape: ArrowShape, dx: number, dy: number): Partial<ArrowShape> {
  return normalizedLinePatch(shape, translatePoints(effectiveLinePoints(shape), dx, dy))
}

/** Shift-constrain only the moving endpoint to the nearest 45-degree ray from its anchor. */
export function constrainLineEndpoint(point: Point, anchor: Point): Point {
  const dx = point.x - anchor.x
  const dy = point.y - anchor.y
  const distance = Math.hypot(dx, dy)
  if (distance < EPSILON) return { ...anchor }
  const step = Math.PI / 4
  const angle = Math.atan2(dy, dx)
  const snapped = Math.round(angle / step) * step
  return {
    x: anchor.x + Math.cos(snapped) * distance,
    y: anchor.y + Math.sin(snapped) * distance
  }
}
