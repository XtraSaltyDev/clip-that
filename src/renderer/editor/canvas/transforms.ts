import type { Shape } from '@shared/types'

export interface TransformNodeLike {
  x(): number
  y(): number
  width(): number
  height(): number
  scaleX(): number
  scaleY(): number
  rotation(): number
}

const positiveScale = (value: number) => Math.max(0.01, Math.abs(value || 1))

function pointsCenter(points: number[]): { x: number; y: number } {
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

/** Bake a Konva transform into document geometry and retain rotation as shape state. */
export function shapeTransformPatch(shape: Shape, node: TransformNodeLike): Partial<Shape> {
  const sx = positiveScale(node.scaleX())
  const sy = positiveScale(node.scaleY())
  const rotation = node.rotation()

  if ('points' in shape) {
    const center = pointsCenter(shape.points)

    return {
      points: shape.points.map((value, index) => {
        const factor = index % 2 === 0 ? sx : sy
        const origin = index % 2 === 0 ? center.x : center.y
        const position = index % 2 === 0 ? node.x() : node.y()
        return (value - origin) * factor + position
      }),
      rotation
    }
  }

  if (shape.type === 'ellipse') {
    const width = Math.max(2, Math.abs(shape.width) * sx)
    const height = Math.max(2, Math.abs(shape.height) * sy)
    return { x: node.x() - width / 2, y: node.y() - height / 2, width, height, rotation }
  }

  if (shape.type === 'text') {
    return { x: node.x(), y: node.y(), width: Math.max(30, Math.abs(shape.width) * sx), rotation }
  }

  if (shape.type === 'callout') {
    return {
      x: node.x(),
      y: node.y(),
      width: Math.max(60, Math.abs(shape.width) * sx),
      height: Math.max(36, Math.abs(shape.height ?? 80) * sy),
      rotation
    }
  }

  if (shape.type === 'step') return { x: node.x(), y: node.y(), rotation }

  // Spotlight's selectable root owns full-canvas dimming bands; its annotation rectangle is
  // nested inside, so the root node's x/y/size are not the shape geometry.
  if (shape.type === 'spotlight') return { rotation }

  if ('width' in shape && 'height' in shape) {
    return {
      x: node.x(),
      y: node.y(),
      width: Math.max(1, Math.abs(shape.width) * sx),
      height: Math.max(1, Math.abs(shape.height ?? 1) * sy),
      rotation
    }
  }

  return { rotation }
}
