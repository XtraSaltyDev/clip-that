import type { OcrResult, OcrWord, Rect } from './types'

/** Increment when the trusted-text rules change and cached Library OCR must be rebuilt. */
export const OCR_TRUST_VERSION = 1

export interface OcrAssessment {
  trusted: OcrResult
  disposition: 'accepted' | 'mixed' | 'rejected'
  rawAvailable: boolean
  rejectedWords: number
}

const SHORT_LABELS = new Set(['a', 'i', 'id', 'ip', 'ok', 'qr', 'ui'])

function overlaps(a: Rect, b: Rect): boolean {
  const top = Math.max(a.y, b.y)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return bottom - top > Math.min(a.height, b.height) * 0.5
}

/** Process-neutral line grouping used by both editor Context and background indexing. */
export function qualityLines(words: OcrWord[]): OcrWord[][] {
  const sorted = [...words].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
  const lines: Array<{ band: Rect; words: OcrWord[] }> = []
  for (const word of sorted) {
    let target: (typeof lines)[number] | undefined
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 4; i--) {
      if (overlaps(lines[i].band, word.bbox)) {
        target = lines[i]
        break
      }
    }
    if (target) {
      target.words.push(word)
      const top = Math.min(target.band.y, word.bbox.y)
      const bottom = Math.max(target.band.y + target.band.height, word.bbox.y + word.bbox.height)
      target.band = { ...target.band, y: top, height: bottom - top }
    } else {
      lines.push({ band: { ...word.bbox }, words: [word] })
    }
  }
  return lines
    .map((line) => line.words.sort((a, b) => a.bbox.x - b.bbox.x))
    .sort((a, b) => a[0].bbox.y - b[0].bbox.y)
}

export function meaningfulCharacterRatio(text: string): number {
  const compact = text.replace(/\s/g, '')
  if (!compact) return 0
  const meaningful = compact.match(/[\p{L}\p{N}@:/._+#€£¥$%&()-]/gu)?.length ?? 0
  return meaningful / compact.length
}

function plausibleToken(text: string): boolean {
  const normalized = text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  if (!normalized) return false
  if (/^\d+(?:[.,:/-]\d+)*$/.test(normalized)) return true
  if (/^[a-z]+$/i.test(normalized)) {
    if (normalized.length <= 2) return SHORT_LABELS.has(normalized.toLowerCase())
    return /[aeiouy]/i.test(normalized)
  }
  return /[\p{L}\p{N}]/u.test(normalized) && meaningfulCharacterRatio(text) >= 0.75
}

function wordCandidate(word: OcrWord): boolean {
  return (
    word.confidence >= 62 &&
    meaningfulCharacterRatio(word.text) >= 0.65 &&
    plausibleToken(word.text)
  )
}

function averageConfidence(words: OcrWord[]): number {
  return words.length === 0
    ? 0
    : words.reduce((sum, word) => sum + word.confidence, 0) / words.length
}

function hasValidEntity(text: string): boolean {
  if (/\b(?:https?:\/\/|www\.)[^\s<>"']{4,}/i.test(text)) {
    const value = text.match(/\b(?:https?:\/\/|www\.)[^\s<>"']{4,}/i)?.[0]
    if (value) {
      try {
        const url = new URL(value.startsWith('http') ? value : `https://${value}`)
        if (
          /^https?:$/.test(url.protocol) &&
          url.hostname.includes('.') &&
          !url.hostname.endsWith('.')
        ) {
          return true
        }
      } catch {}
    }
  }
  return (
    /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/.test(text) ||
    /#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/i.test(text) ||
    /[$€£¥]\s?\d[\d,]*(?:\.\d{2})?/.test(text) ||
    /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/.test(text)
  )
}

function coherentLine(line: OcrWord[]): OcrWord[] {
  const candidates = line.filter(wordCandidate)
  if (candidates.length === 0) return []
  const candidateShare = candidates.length / line.length
  const plausibleShare =
    candidates.filter((word) => plausibleToken(word.text)).length / candidates.length
  const shortNoiseShare =
    candidates.filter((word) => {
      const token = word.text.replace(/[^\p{L}\p{N}]/gu, '')
      return token.length <= 2 && !SHORT_LABELS.has(token.toLowerCase())
    }).length / candidates.length
  const confidence = averageConfidence(candidates)
  const entityEvidence = hasValidEntity(candidates.map((word) => word.text).join(' '))

  if (entityEvidence && line.length <= 4 && confidence >= 68) return candidates
  if (candidates.length === 1) {
    const token = candidates[0].text.replace(/[^\p{L}\p{N}]/gu, '')
    if (/^\d$/.test(token)) return []
    return confidence >= 80 && plausibleShare === 1 ? candidates : []
  }
  if (candidateShare < 0.55 || plausibleShare < 0.7 || shortNoiseShare > 0.3) return []
  if (confidence < (candidates.length <= 3 ? 72 : 66)) return []
  return candidates
}

/** The one trusted-text boundary used by Context and the background Library indexer. */
export function assessOcr(ocr: OcrResult): OcrAssessment {
  const rawWords = ocr.words.filter((word) => word.text.trim())
  const trustedWords = qualityLines(rawWords).flatMap(coherentLine)
  const trustedText = qualityLines(trustedWords)
    .map((line) =>
      line
        .map((word) => word.text.trim())
        .filter(Boolean)
        .join(' ')
    )
    .filter(Boolean)
    .join('\n')
  const rejectedWords = rawWords.length - trustedWords.length
  const disposition =
    trustedWords.length === 0 ? 'rejected' : rejectedWords === 0 ? 'accepted' : 'mixed'
  return {
    trusted: { text: trustedText, words: trustedWords },
    disposition,
    rawAvailable: Boolean(ocr.text.trim()) && disposition !== 'accepted',
    rejectedWords
  }
}
