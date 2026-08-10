import type { CanvasStyle } from '@shared/types'

export interface CanvasTiltTransform {
  skewX: number
  skewY: number
  scaleX: number
  scaleY: number
}

const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * Convert stored tilt controls into the skew/foreshortening approximation used by Konva.
 * New documents use visible-axis semantics; legacy documents retain their v0.1.7 mapping.
 */
export function canvasTiltTransform(
  canvas: Pick<CanvasStyle, 'tiltX' | 'tiltY' | 'tiltSemantics'>
): CanvasTiltTransform {
  const legacy = canvas.tiltSemantics !== 'visible-axis'
  const horizontal = legacy ? canvas.tiltY : canvas.tiltX
  const vertical = legacy ? canvas.tiltX : canvas.tiltY

  return legacy
    ? {
        // Preserve the v0.1.7 transform exactly for legacy documents.
        skewX: -vertical * 0.012,
        skewY: horizontal * 0.012,
        scaleX: Math.cos(rad(Math.abs(horizontal) * 0.6)),
        scaleY: Math.cos(rad(Math.abs(vertical) * 0.6))
      }
    : {
        // Visible horizontal and vertical controls affect orthogonal matrix terms.
        skewX: horizontal * 0.012,
        skewY: vertical * 0.012,
        scaleX: Math.cos(rad(Math.abs(vertical) * 0.6)),
        scaleY: Math.cos(rad(Math.abs(horizontal) * 0.6))
      }
}
