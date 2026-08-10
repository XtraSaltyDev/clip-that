import type {
  ArrowShape,
  BoxShape,
  CutOutAxis,
  CutOutEdge,
  CutOutOperation,
  FreehandShape,
  Rect,
  Shape,
  StepShape,
  TextShape
} from './types'

export const CUT_OUT_MIN_SIZE = 4
export const CUT_OUT_EDGES: readonly CutOutEdge[] = ['straight', 'zigzag', 'wave', 'triangle']

export interface CutOutImageSegment {
  sx: number
  sy: number
  width: number
  height: number
  dx: number
  dy: number
}

export function isValidCutOutSelection(
  operation: Pick<CutOutOperation, 'source' | 'axis' | 'start' | 'size'>,
  minimum = CUT_OUT_MIN_SIZE
): boolean {
  const length = operation.axis === 'horizontal' ? operation.source.height : operation.source.width
  return (
    operation.source.width > 0 &&
    operation.source.height > 0 &&
    operation.start >= minimum &&
    operation.size >= minimum &&
    operation.start + operation.size <= length - minimum
  )
}

type Point = { x: number; y: number }
type Side = 'before' | 'after'

const EPSILON = 0.0001

export function cutOutContentSize(source: Pick<Rect, 'width' | 'height'>, operation: CutOutOperation): {
  width: number
  height: number
} {
  return operation.axis === 'horizontal'
    ? { width: source.width, height: source.height - operation.size }
    : { width: source.width - operation.size, height: source.height }
}

/** The two source-image slices that are joined after the band is removed. */
export function cutOutImageSegments(operation: CutOutOperation): CutOutImageSegment[] {
  const source = operation.source
  const end = operation.start + operation.size
  if (operation.axis === 'horizontal') {
    const segments: CutOutImageSegment[] = []
    if (operation.start > 0) {
      segments.push({
        sx: source.x,
        sy: source.y,
        width: source.width,
        height: operation.start,
        dx: 0,
        dy: 0
      })
    }
    if (source.height - end > 0) {
      segments.push({
        sx: source.x,
        sy: source.y + end,
        width: source.width,
        height: source.height - end,
        dx: 0,
        dy: operation.start
      })
    }
    return segments
  }

  const segments: CutOutImageSegment[] = []
  if (operation.start > 0) {
    segments.push({
      sx: source.x,
      sy: source.y,
      width: operation.start,
      height: source.height,
      dx: 0,
      dy: 0
    })
  }
  if (source.width - end > 0) {
    segments.push({
      sx: source.x + end,
      sy: source.y,
      width: source.width - end,
      height: source.height,
      dx: operation.start,
      dy: 0
    })
  }
  return segments
}

export function cutOutEdgeAmplitude(operation: Pick<CutOutOperation, 'size'>, length: number): number {
  return Math.min(14, Math.max(3, operation.size * 0.18), Math.max(3, length * 0.05))
}

/** Return a flat Konva/Canvas point list for the selected edge preset. */
export function cutOutEdgePath(
  axis: CutOutAxis,
  length: number,
  seam: number,
  edge: CutOutEdge,
  amplitude: number
): number[] {
  if (edge === 'straight' || length <= 0) {
    return axis === 'horizontal' ? [0, seam, length, seam] : [seam, 0, seam, length]
  }

  const count = Math.max(2, Math.ceil(length / 28))
  const points: number[] = []
  for (let index = 0; index <= count; index += 1) {
    const along = (length * index) / count
    const phase = index / count
    let offset = 0
    if (index !== 0 && index !== count) {
      if (edge === 'zigzag') offset = index % 2 === 0 ? -amplitude : amplitude
      else if (edge === 'triangle') offset = index % 2 === 0 ? 0 : -amplitude
      else offset = Math.sin(phase * Math.PI * 2 * Math.max(1, count / 3)) * amplitude
    }
    if (axis === 'horizontal') points.push(along, seam + offset)
    else points.push(seam + offset, along)
  }
  return points
}

export function mapCutOutPoint(point: Point, operation: CutOutOperation): Point {
  const localX = point.x - operation.source.x
  const localY = point.y - operation.source.y
  if (operation.axis === 'horizontal') {
    return { x: localX, y: mapAxisValue(localY, operation.start, operation.size) }
  }
  return { x: mapAxisValue(localX, operation.start, operation.size), y: localY }
}

function mapAxisValue(value: number, start: number, size: number): number {
  const end = start + size
  if (value <= start) return value
  if (value >= end) return value - size
  return start
}

function axisValue(point: Point, axis: CutOutAxis): number {
  return axis === 'horizontal' ? point.y : point.x
}

function axisOrigin(operation: CutOutOperation): number {
  return operation.axis === 'horizontal' ? operation.source.y : operation.source.x
}

function sideForValue(value: number, operation: CutOutOperation): Side | null {
  if (value < operation.start - EPSILON) return 'before'
  if (value > operation.start + operation.size + EPSILON) return 'after'
  return null
}

function pointAt(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function appendPoint(points: number[], point: Point): void {
  const lastX = points.at(-2)
  const lastY = points.at(-1)
  if (lastX !== undefined && lastY !== undefined && Math.hypot(lastX - point.x, lastY - point.y) < EPSILON) return
  points.push(point.x, point.y)
}

function polylinePieces(points: number[], operation: CutOutOperation): Array<{ side: Side; points: number[] }> {
  const pieces: Array<{ side: Side; points: number[] }> = []
  const start = operation.start
  const end = operation.start + operation.size
  const origin = axisOrigin(operation)

  const append = (side: Side, a: Point, b: Point) => {
    const previous = pieces.at(-1)
    const mappedA = mapCutOutPoint(a, operation)
    const mappedB = mapCutOutPoint(b, operation)
    if (previous && previous.side === side) {
      appendPoint(previous.points, mappedA)
      appendPoint(previous.points, mappedB)
    } else {
      const next = { side, points: [] as number[] }
      appendPoint(next.points, mappedA)
      appendPoint(next.points, mappedB)
      pieces.push(next)
    }
  }

  for (let index = 0; index + 3 < points.length; index += 2) {
    const a = { x: points[index], y: points[index + 1] }
    const b = { x: points[index + 2], y: points[index + 3] }
    const av = axisValue(a, operation.axis) - origin
    const bv = axisValue(b, operation.axis) - origin
    const values = [0, 1]
    if (bv !== av) {
      for (const boundary of [start, end]) {
        const t = (boundary - av) / (bv - av)
        if (t > EPSILON && t < 1 - EPSILON) values.push(t)
      }
    }
    values.sort((left, right) => left - right)
    for (let step = 0; step + 1 < values.length; step += 1) {
      const from = values[step]
      const to = values[step + 1]
      const middle = pointAt(a, b, (from + to) / 2)
      const side = sideForValue(axisValue(middle, operation.axis) - origin, operation)
      if (side) append(side, pointAt(a, b, from), pointAt(a, b, to))
    }
  }

  return pieces.filter((piece) => piece.points.length >= 4)
}

function withoutClip<T extends Shape>(shape: T): T {
  const next = { ...shape } as T
  delete next.clipRects
  return next
}

function shapeId(shape: Shape, index: number): string {
  return index === 0 ? shape.id : `${shape.id}-cut-${index}`
}

function splitPolylineShape(shape: ArrowShape | FreehandShape, operation: CutOutOperation): Shape[] {
  const pieces = polylinePieces(shape.points, operation)
  if (pieces.length === 0) {
    const center = mapCutOutPoint(
      { x: operation.source.x + operation.source.width / 2, y: operation.source.y + operation.source.height / 2 },
      operation
    )
    return [{
      ...withoutClip(shape),
      points: shape.points.map((_, index) => (index % 2 === 0 ? center.x : center.y)),
      hidden: true
    } as Shape]
  }

  return pieces.map((piece, index) => {
    const next = {
      ...withoutClip(shape),
      id: shapeId(shape, index),
      points: piece.points
    } as ArrowShape | FreehandShape
    if ('endHead' in shape) {
      const arrow = next as ArrowShape
      arrow.startHead = index === 0 ? shape.startHead : false
      arrow.endHead = index === pieces.length - 1 ? shape.endHead : false
    }
    if ('curve' in next && pieces.length > 1) next.curve = 0
    return next as Shape
  })
}

function normalizedBox(shape: BoxShape | TextShape): Rect {
  const x2 = shape.x + shape.width
  const y2 = shape.y + (shape.height ?? 0)
  return {
    x: Math.min(shape.x, x2),
    y: Math.min(shape.y, y2),
    width: Math.abs(shape.width),
    height: Math.abs(y2 - shape.y)
  }
}

function boxPieces(box: Rect, operation: CutOutOperation): Rect[] {
  const source = operation.source
  const left = Math.max(box.x, source.x)
  const right = Math.min(box.x + box.width, source.x + source.width)
  const top = Math.max(box.y, source.y)
  const bottom = Math.min(box.y + box.height, source.y + source.height)
  if (right - left <= EPSILON || bottom - top <= EPSILON) return []

  const bandStart = axisOrigin(operation) + operation.start
  const bandEnd = bandStart + operation.size
  const rects: Rect[] = []
  if (operation.axis === 'horizontal') {
    const topEnd = Math.min(bottom, bandStart)
    if (topEnd > top + EPSILON) {
      rects.push({ x: left - source.x, y: top - source.y, width: right - left, height: topEnd - top })
    }
    const bottomStart = Math.max(top, bandEnd)
    if (bottom > bottomStart + EPSILON) {
      rects.push({
        x: left - source.x,
        y: bottomStart - source.y - operation.size,
        width: right - left,
        height: bottom - bottomStart
      })
    }
  } else {
    const leftEnd = Math.min(right, bandStart)
    if (leftEnd > left + EPSILON) {
      rects.push({ x: left - source.x, y: top - source.y, width: leftEnd - left, height: bottom - top })
    }
    const rightStart = Math.max(left, bandEnd)
    if (right > rightStart + EPSILON) {
      rects.push({
        x: rightStart - source.x - operation.size,
        y: top - source.y,
        width: right - rightStart,
        height: bottom - top
      })
    }
  }
  return rects
}

function mappedBox(box: Rect, operation: CutOutOperation): Rect {
  const left = box.x
  const top = box.y
  const right = box.x + box.width
  const bottom = box.y + box.height
  const a = mapCutOutPoint({ x: left, y: top }, operation)
  const b = mapCutOutPoint({ x: right, y: bottom }, operation)
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  }
}

function boundsOf(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function transformBoxShape(shape: BoxShape, operation: CutOutOperation): Shape[] {
  const box = normalizedBox(shape)
  const pieces = boxPieces(box, operation)
  if (pieces.length === 0) {
    const collapsed = mappedBox({
      x: box.x,
      y: box.y,
      width: Math.max(1, box.width),
      height: Math.max(1, box.height)
    }, operation)
    return [{ ...withoutClip(shape), ...collapsed, width: Math.max(1, collapsed.width), height: Math.max(1, collapsed.height), hidden: true } as Shape]
  }
  if (pieces.length === 1 && !boxCrossesCut(box, operation)) {
    return [{ ...withoutClip(shape), ...pieces[0] } as Shape]
  }
  return pieces.map((piece, index) => ({
    ...withoutClip(shape),
    id: shapeId(shape, index),
    ...piece
  } as Shape))
}

function boxCrossesCut(box: Rect, operation: CutOutOperation): boolean {
  const value = operation.axis === 'horizontal' ? box.y : box.x
  const extent = operation.axis === 'horizontal' ? box.height : box.width
  const start = axisOrigin(operation) + operation.start
  const end = start + operation.size
  return value < start - EPSILON && value + extent > end + EPSILON
}

function transformTextShape(shape: TextShape, operation: CutOutOperation): Shape[] {
  const sourceBox = normalizedBox({ ...shape, height: shape.height ?? Math.max(1, shape.fontSize * 1.4) })
  const pieces = boxPieces(sourceBox, operation)
  if (pieces.length === 0) {
    const collapsed = mappedBox(sourceBox, operation)
    return [{
      ...withoutClip(shape),
      x: collapsed.x,
      y: collapsed.y,
      width: Math.max(30, collapsed.width),
      ...(shape.height === undefined ? {} : { height: Math.max(1, collapsed.height) }),
      hidden: true
    } as Shape]
  }

  const bounds = boundsOf(pieces)
  const next = {
    ...withoutClip(shape),
    x: bounds.x,
    y: bounds.y,
    width: Math.max(30, bounds.width),
    ...(shape.height === undefined ? {} : { height: Math.max(1, bounds.height) }),
    clipRects: pieces
  } as TextShape
  if (shape.type === 'callout') {
    const tail = shape.tail ?? { x: shape.width / 2, y: (shape.height ?? 80) + 40 }
    const absoluteTail = { x: shape.x + tail.x, y: shape.y + tail.y }
    const mappedTail = mapCutOutPoint(absoluteTail, operation)
    next.tail = { x: mappedTail.x - bounds.x, y: mappedTail.y - bounds.y }
  }
  return [next]
}

function transformStepShape(shape: StepShape, operation: CutOutOperation): Shape[] {
  const box = {
    x: shape.x - shape.radius,
    y: shape.y - shape.radius,
    width: shape.radius * 2,
    height: shape.radius * 2
  }
  const pieces = boxPieces(box, operation)
  if (pieces.length === 0) {
    const center = mapCutOutPoint({ x: shape.x, y: shape.y }, operation)
    return [{ ...withoutClip(shape), x: center.x, y: center.y, hidden: true } as Shape]
  }
  const center = mapCutOutPoint({ x: shape.x, y: shape.y }, operation)
  return [{
    ...withoutClip(shape),
    x: center.x,
    y: center.y,
    clipRects: boxCrossesCut(box, operation) ? pieces : undefined
  } as Shape]
}

function transformShape(shape: Shape, operation: CutOutOperation): Shape[] {
  if (shape.type === 'arrow' || shape.type === 'line' || shape.type === 'measure') {
    return splitPolylineShape(shape as ArrowShape, operation)
  }
  if (shape.type === 'pen' || shape.type === 'highlighter') {
    return splitPolylineShape(shape as FreehandShape, operation)
  }
  if (shape.type === 'text' || shape.type === 'callout') {
    return transformTextShape(shape as TextShape, operation)
  }
  if (shape.type === 'step') return transformStepShape(shape as StepShape, operation)
  return transformBoxShape(shape as BoxShape, operation)
}

/** Transform editable annotations into the coordinate space after one band removal. */
export function transformShapesForCutOut(shapes: Shape[], operation: CutOutOperation): Shape[] {
  return shapes.flatMap((shape) => transformShape(shape, operation))
}
