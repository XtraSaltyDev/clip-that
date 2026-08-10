import { cutOutContentSize, cutOutEdgeAmplitude, cutOutEdgePath, cutOutImageSegments } from '@shared/cut-out'
import type { CutOutOperation } from '@shared/types'

/**
 * Render one Cut Out operation into a normal image. Keeping this derived image in the
 * renderer means Konva, filters, flattening, thumbnails, and reopened projects all consume
 * the same pixels instead of each inventing a separate cutout path.
 */
export function renderCutOutImage(image: HTMLImageElement, operation: CutOutOperation): string {
  const size = cutOutContentSize(operation.source, operation)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(size.width))
  canvas.height = Math.max(1, Math.round(size.height))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The image canvas is unavailable')

  for (const segment of cutOutImageSegments(operation)) {
    context.drawImage(
      image,
      segment.sx,
      segment.sy,
      segment.width,
      segment.height,
      segment.dx,
      segment.dy,
      segment.width,
      segment.height
    )
  }

  const length = operation.axis === 'horizontal' ? size.width : size.height
  const seam = operation.start
  const path = cutOutEdgePath(
    operation.axis,
    length,
    seam,
    operation.edge,
    cutOutEdgeAmplitude(operation, length)
  )
  context.beginPath()
  for (let index = 0; index + 1 < path.length; index += 2) {
    const x = path[index]
    const y = path[index + 1]
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.strokeStyle = 'rgba(255, 255, 255, 0.86)'
  context.lineWidth = Math.max(1, Math.min(3, Math.round(Math.min(size.width, size.height) / 280)))
  context.lineJoin = 'round'
  context.lineCap = 'round'
  context.shadowColor = 'rgba(0, 0, 0, 0.45)'
  context.shadowBlur = 2
  context.stroke()

  return canvas.toDataURL('image/png')
}
