import { assessOcr, OCR_TRUST_VERSION } from '../../shared/ocr-quality'
import type { LibraryItem, OcrResult } from '@shared/types'

export function trustedOcrText(result: OcrResult): string {
  return assessOcr(result).trusted.text.trim()
}

export function hasCurrentOcr(item: LibraryItem): boolean {
  return item.ocrVersion === OCR_TRUST_VERSION
}

export function needsOcrUpgrade(item: LibraryItem): boolean {
  return item.kind === 'image' && !hasCurrentOcr(item)
}

export function searchableOcrText(item: LibraryItem): string {
  return hasCurrentOcr(item) ? (item.ocrText ?? '') : ''
}

/** Legacy OCR is retained on disk only until rebuilt, but never leaves main as trusted data. */
export function publicLibraryItem(item: LibraryItem): LibraryItem {
  if (hasCurrentOcr(item)) return { ...item, tags: [...item.tags] }
  const safe = { ...item, tags: [...item.tags] }
  delete safe.ocrText
  return safe
}

/** Pure migration primitive: only OCR cache fields change; user metadata is byte-for-byte stable. */
export function withTrustedOcr(item: LibraryItem, text: string): LibraryItem {
  return {
    ...item,
    tags: [...item.tags],
    ocrText: text,
    ocrVersion: OCR_TRUST_VERSION
  }
}

export function nextOcrUpgradeBatch(
  items: readonly LibraryItem[],
  limit: number,
  excludedIds: ReadonlySet<string> = new Set()
): LibraryItem[] {
  return items
    .filter((item) => needsOcrUpgrade(item) && !excludedIds.has(item.id))
    .slice(0, Math.max(0, limit))
}
