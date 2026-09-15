import type { ClipDocument } from '@shared/types'

/** An OCR response only belongs to the image and crop that started it. */
export function sameOcrSource(current: ClipDocument | null, source: ClipDocument): boolean {
  if (!current || current.id !== source.id || current.image !== source.image) return false
  const a = current.crop,
    b = source.crop
  return (
    a.enabled === b.enabled &&
    (!a.enabled || (a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height))
  )
}
