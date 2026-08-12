import type { ClipDocument, AnnotationInsets } from '@shared/types'
import { cutOutContentSize } from '@shared/cut-out'

export interface Layout {
  /** Visible screenshot area, after crop. */
  contentWidth: number
  contentHeight: number
  /** Crop origin inside the source image. */
  cropX: number
  cropY: number
  /** Padding applied on every side of the screenshot. */
  padding: number
  /** Full output size, padding and window chrome included. */
  canvasWidth: number
  canvasHeight: number
  /** Top-left of the framed screenshot inside the canvas. */
  shotX: number
  shotY: number
  frameHeight: number
  /** Automatic workspace outside the capture, in final canvas pixels. */
  annotationInsets: AnnotationInsets
}

export const ZERO_ANNOTATION_INSETS: AnnotationInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0
}

export function annotationInsets(value: AnnotationInsets | undefined): AnnotationInsets {
  return {
    top: Math.max(0, Number.isFinite(value?.top) ? value!.top : 0),
    right: Math.max(0, Number.isFinite(value?.right) ? value!.right : 0),
    bottom: Math.max(0, Number.isFinite(value?.bottom) ? value!.bottom : 0),
    left: Math.max(0, Number.isFinite(value?.left) ? value!.left : 0)
  }
}

/** Scale the complete canvas into the editor viewport without enlarging small images. */
export function fitScale(
  layout: Pick<Layout, 'canvasWidth' | 'canvasHeight'>,
  containerWidth: number,
  containerHeight: number,
  gutter = 64
): number {
  const availableWidth = Math.max(1, containerWidth - gutter)
  const availableHeight = Math.max(1, containerHeight - gutter)
  return Math.max(
    0.05,
    Math.min(availableWidth / layout.canvasWidth, availableHeight / layout.canvasHeight, 1)
  )
}

/** Height of the fake window title bar, scaled so it looks right on any capture size. */
export function frameHeight(doc: ClipDocument): number {
  if (doc.canvas.frame === 'none') return 0
  const width = doc.cutOuts?.length
    ? cutOutOutputSize(doc).width
    : doc.crop.enabled
      ? doc.crop.width
      : doc.imageWidth
  return Math.round(Math.max(28, Math.min(52, width * 0.035)))
}

/** Aspect-ratio presets grow the padding box rather than stretching the image. */
function applyAspect(
  width: number,
  height: number,
  aspect?: string
): { width: number; height: number } {
  if (!aspect || aspect === 'auto') return { width, height }
  const [aw, ah] = aspect.split(':').map(Number)
  if (!aw || !ah) return { width, height }
  const target = aw / ah
  const current = width / height
  if (Math.abs(target - current) < 0.001) return { width, height }
  return current < target
    ? { width: Math.round(height * target), height }
    : { width, height: Math.round(width / target) }
}

export function computeLayout(doc: ClipDocument): Layout {
  const hasCutOut = Boolean(doc.cutOuts?.length)
  const content = hasCutOut
    ? cutOutOutputSize(doc)
    : doc.crop.enabled
      ? { width: doc.crop.width, height: doc.crop.height }
      : { width: doc.imageWidth, height: doc.imageHeight }
  const contentWidth = Math.max(1, Math.round(content.width))
  const contentHeight = Math.max(1, Math.round(content.height))
  // After a Cut Out the renderer supplies a derived image in output space. Before that,
  // cropX/cropY are the source-image origin used by the normal Konva crop.
  const cropX = hasCutOut ? 0 : doc.crop.enabled ? Math.round(doc.crop.x) : 0
  const cropY = hasCutOut ? 0 : doc.crop.enabled ? Math.round(doc.crop.y) : 0

  const frameH = frameHeight(doc)
  // Padding is stored as a percentage-ish constant; scale it with the capture so a
  // "64" that looks right on a 600px shot doesn't vanish on a 4K one.
  const scale = Math.max(1, Math.min(3, contentWidth / 1200))
  const padding = Math.round(doc.canvas.padding * scale)

  const boxed = applyAspect(
    contentWidth + padding * 2,
    contentHeight + frameH + padding * 2,
    doc.canvas.aspect
  )

  const extra = annotationInsets(doc.canvas.annotationInsets)

  return {
    contentWidth,
    contentHeight,
    cropX,
    cropY,
    padding,
    canvasWidth: boxed.width + extra.left + extra.right,
    canvasHeight: boxed.height + extra.top + extra.bottom,
    // Centre the shot, which also absorbs any extra space an aspect preset added.
    shotX: extra.left + Math.round((boxed.width - contentWidth) / 2),
    shotY: extra.top + Math.round((boxed.height - contentHeight - frameH) / 2),
    frameHeight: frameH,
    annotationInsets: extra
  }
}

function cutOutOutputSize(doc: ClipDocument): { width: number; height: number } {
  const first = doc.cutOuts?.[0]
  if (!first) {
    return doc.crop.enabled
      ? { width: doc.crop.width, height: doc.crop.height }
      : { width: doc.imageWidth, height: doc.imageHeight }
  }

  let size = { width: first.source.width, height: first.source.height }
  for (const operation of doc.cutOuts ?? []) size = cutOutContentSize(size, operation)
  return size
}
