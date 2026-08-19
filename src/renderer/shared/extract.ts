import type { OcrResult, OcrWord, Rect, SensitiveKind, SensitiveMatch } from '@shared/types'
import { meaningfulCharacterRatio } from '../../shared/ocr-quality'
export { assessOcr, type OcrAssessment } from '../../shared/ocr-quality'

/**
 * Everything ClipThat works out about a capture from its OCR word boxes: the things you'd
 * want to copy or open, the table you'd want to paste, the palette, and what should be hidden.
 *
 * All local, all deterministic — no model, no network.
 */

/* ------------------------------------------------------------------ *
 * Lines
 * ------------------------------------------------------------------ */

/**
 * Two words belong to the same visual line when their vertical extents genuinely
 * overlap. Comparing baseline positions instead (the obvious approach) merges a
 * heading with the subtitle underneath it whenever the heading is tall.
 */
function overlaps(a: Rect, b: Rect): boolean {
  const top = Math.max(a.y, b.y)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return bottom - top > Math.min(a.height, b.height) * 0.5
}

/** Group words into visual lines, top-to-bottom then left-to-right. */
export function toLines(words: OcrWord[]): OcrWord[][] {
  const sorted = [...words].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
  const lines: Array<{ band: Rect; words: OcrWord[] }> = []

  for (const word of sorted) {
    // Only the most recent few lines can still be open; scanning them all is wasteful
    // and risks matching a line that ended long ago.
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
    .map((l) => l.words.sort((a, b) => a.bbox.x - b.bbox.x))
    .sort((a, b) => a[0].bbox.y - b[0].bbox.y)
}

export function unionBox(words: OcrWord[]): Rect {
  const x = Math.min(...words.map((w) => w.bbox.x))
  const y = Math.min(...words.map((w) => w.bbox.y))
  const right = Math.max(...words.map((w) => w.bbox.x + w.bbox.width))
  const bottom = Math.max(...words.map((w) => w.bbox.y + w.bbox.height))
  return { x, y, width: right - x, height: bottom - y }
}

/** Words covering [start, start+length) within a line's joined text. */
function spanWords(line: OcrWord[], start: number, length: number): OcrWord[] {
  const end = start + length
  let cursor = 0
  const covered: OcrWord[] = []
  for (const word of line) {
    if (cursor < end && cursor + word.text.length > start) covered.push(word)
    cursor += word.text.length + 1
  }
  return covered
}

/**
 * OCR reports typographic dashes for what the page rendered as a hyphen, and a stray
 * dash is enough to make `sk-…` slip past a secret detector. Fold them to ASCII first.
 */
export function normalizeDashes(text: string): string {
  return text.replace(/[‐-―⁃−﹘﹣－]/g, '-')
}

/* ------------------------------------------------------------------ *
 * Entities
 * ------------------------------------------------------------------ */

export interface Entity {
  kind: 'url' | 'email' | 'phone' | 'ip' | 'color' | 'money' | 'date'
  text: string
  /** Value to put on the clipboard, when it differs from the visible text. */
  value?: string
  bbox: Rect
}

const PATTERNS: Array<{ kind: Entity['kind']; re: RegExp; clean?: (v: string) => string }> = [
  {
    kind: 'url',
    re: /\b(?:https?:\/\/|www\.)[^\s<>"']{4,}/gi,
    clean: (v) => (v.startsWith('http') ? v : `https://${v}`)
  },
  { kind: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g },
  { kind: 'ip', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { kind: 'color', re: /#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi },
  { kind: 'money', re: /[$€£¥]\s?\d[\d,]*(?:\.\d{2})?/g },
  {
    kind: 'date',
    re: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi
  },
  { kind: 'phone', re: /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3}[\s-]\d{3,4}[\s-]?\d{0,4}/g }
]

const ENTITY_MIN_CONFIDENCE: Record<Entity['kind'], number> = {
  url: 55,
  email: 65,
  phone: 72,
  ip: 68,
  color: 62,
  money: 78,
  date: 68
}

function averageConfidence(words: OcrWord[]): number {
  if (words.length === 0) return 0
  return words.reduce((sum, word) => sum + word.confidence, 0) / words.length
}

function validEntity(kind: Entity['kind'], value: string): boolean {
  if (kind === 'url') {
    const normalized = value.startsWith('http') ? value : `https://${value}`
    try {
      const url = new URL(normalized)
      return (
        /^https?:$/.test(url.protocol) && url.hostname.includes('.') && !url.hostname.endsWith('.')
      )
    } catch {
      return false
    }
  }
  if (kind === 'ip') return value.split('.').every((octet) => Number(octet) <= 255)
  if (kind === 'money')
    return Number.isFinite(Number(value.replace(/[^\d.-]/g, '').replace(/,/g, '')))
  return true
}

export function extractEntities(ocr: OcrResult): Entity[] {
  const out: Entity[] = []
  const seen = new Set<string>()

  for (const line of toLines(ocr.words)) {
    const text = normalizeDashes(line.map((w) => w.text).join(' '))
    for (const { kind, re, clean } of PATTERNS) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        const raw = m[0].trim()
        if (!raw) continue
        if (kind === 'phone') {
          const digits = raw.replace(/\D/g, '')
          if (digits.length < 10 || digits.length > 15) continue
        }
        const key = `${kind}:${raw}`
        if (seen.has(key)) continue
        const covered = spanWords(line, m.index, m[0].length)
        if (covered.length === 0) continue
        if (averageConfidence(covered) < ENTITY_MIN_CONFIDENCE[kind]) continue
        if (!validEntity(kind, raw)) continue
        seen.add(key)
        const cleaned = clean?.(raw)
        out.push({
          kind,
          text: raw,
          value: cleaned !== raw ? cleaned : undefined,
          bbox: unionBox(covered)
        })
      }
    }
  }

  // A card number contains something shaped exactly like a phone number. Anything the
  // stronger secret detectors already claimed is not also an entity.
  const claimed = findSensitive(ocr)
    .filter(
      (m) => m.kind === 'creditCard' || m.kind === 'apiKey' || m.kind === 'jwt' || m.kind === 'ssn'
    )
    .map((m) => m.bbox)

  const filtered = out.filter((e) => {
    if (e.kind !== 'phone') return true
    return !claimed.some((c) => overlapRatio(e.bbox, c) > 0.5)
  })

  return dropOverlaps(
    filtered,
    (e) => e.bbox,
    (e) => (e.kind === 'phone' ? 0 : 1)
  )
}

/** Intersection area as a fraction of the smaller box. */
function overlapRatio(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  const smaller = Math.min(a.width * a.height, b.width * b.height) || 1
  return (w * h) / smaller
}

/**
 * Drop boxes that mostly sit inside a box we already kept. A card number contains
 * something that reads like a phone number; only the stronger match should survive.
 */
function dropOverlaps<T>(items: T[], box: (item: T) => Rect, rank: (item: T) => number): T[] {
  const sorted = [...items].sort((a, b) => {
    const r = rank(b) - rank(a)
    if (r !== 0) return r
    return box(b).width * box(b).height - box(a).width * box(a).height
  })

  const kept: T[] = []
  for (const item of sorted) {
    const a = box(item)
    const collides = kept.some((k) => overlapRatio(a, box(k)) > 0.6)
    if (!collides) kept.push(item)
  }
  return kept
}

/* ------------------------------------------------------------------ *
 * Sensitive data
 * ------------------------------------------------------------------ */

interface Detector {
  kind: SensitiveKind
  pattern: RegExp
  /** Higher wins when two detectors claim the same pixels. */
  rank: number
  verify?: (value: string) => boolean
  minConfidence?: number
}

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

/** Upper/lower case transitions — a cheap proxy for randomness. */
function countCase(value: string): number {
  let flips = 0
  for (let i = 1; i < value.length; i++) {
    const a = value[i - 1]
    const b = value[i]
    if (/[a-z]/.test(a) && /[A-Z]/.test(b)) flips++
    else if (/[A-Z]/.test(a) && /[a-z]/.test(b)) flips++
  }
  return flips
}

const DETECTORS: Detector[] = [
  { kind: 'jwt', rank: 6, minConfidence: 52, pattern: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g },
  {
    kind: 'apiKey',
    rank: 6,
    minConfidence: 52,
    pattern:
      /(?:sk|rk)-+[A-Za-z0-9_-]{12,}|pk_(?:live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{15,}/g
  },
  {
    kind: 'apiKey',
    rank: 5,
    minConfidence: 60,
    // Generic high-entropy token: long, mixed case, contains digits.
    pattern: /\b[A-Za-z0-9_+/=-]{24,}\b/g,
    verify: (v) =>
      /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v) && !/^\d+$/.test(v) && countCase(v) >= 4
  },
  {
    kind: 'creditCard',
    rank: 4,
    minConfidence: 68,
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    verify: (v) => luhn(v.replace(/\D/g, ''))
  },
  { kind: 'ssn', rank: 4, minConfidence: 72, pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: 'email', rank: 3, minConfidence: 65, pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g },
  {
    kind: 'ipv4',
    rank: 2,
    minConfidence: 68,
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    verify: (v) => v.split('.').every((o) => Number(o) <= 255)
  },
  {
    // No `\b` in front: a leading "+" is not a word character, so a boundary never matches.
    kind: 'phone',
    rank: 1,
    minConfidence: 72,
    pattern: /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3}[\s-]\d{3,4}[\s-]?\d{0,4}/g,
    verify: (v) => {
      const digits = v.replace(/\D/g, '')
      return digits.length >= 10 && digits.length <= 15
    }
  }
]

/**
 * Find secrets in OCR output and give back the boxes covering them. Matches are
 * resolved per line so a value split across words still gets one box, and weaker
 * detectors never redact a slice of something a stronger one already claimed.
 */
export function findSensitive(ocr: OcrResult): SensitiveMatch[] {
  const found: Array<SensitiveMatch & { rank: number }> = []

  for (const line of toLines(ocr.words)) {
    const text = normalizeDashes(line.map((w) => w.text).join(' '))
    for (const detector of DETECTORS) {
      detector.pattern.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = detector.pattern.exec(text))) {
        const value = m[0].trim()
        if (!value || (detector.verify && !detector.verify(value))) continue
        const covered = spanWords(line, m.index, m[0].length)
        if (covered.length === 0) continue
        if (averageConfidence(covered) < (detector.minConfidence ?? 65)) continue
        found.push({
          kind: detector.kind,
          text: value,
          bbox: unionBox(covered),
          rank: detector.rank
        })
      }
    }
  }

  return dropOverlaps(
    found,
    (m) => m.bbox,
    (m) => m.rank
  ).map(({ rank, ...rest }) => rest)
}

export const SENSITIVE_LABELS: Record<SensitiveKind, string> = {
  email: 'Email address',
  ipv4: 'IP address',
  creditCard: 'Card number',
  phone: 'Phone number',
  jwt: 'JWT token',
  apiKey: 'API key',
  ssn: 'Social security number'
}

/* ------------------------------------------------------------------ *
 * Table detection
 * ------------------------------------------------------------------ */

export interface DetectedTable {
  rows: string[][]
  markdown: string
  csv: string
  columns: number
  bbox: Rect
}

function clusterColumns(lines: OcrWord[][], tolerance: number, minShare: number): number[] {
  const starts = lines.flatMap((line) => line.map((w) => w.bbox.x)).sort((a, b) => a - b)
  const clusters: number[][] = []
  for (const x of starts) {
    const last = clusters[clusters.length - 1]
    if (last && x - last[last.length - 1] <= tolerance) last.push(x)
    else clusters.push([x])
  }
  // A real column is one that most rows actually start a cell in.
  return clusters
    .filter((c) => c.length >= Math.max(2, Math.ceil(lines.length * minShare)))
    .map((c) => c.reduce((a, b) => a + b, 0) / c.length)
    .sort((a, b) => a - b)
}

/**
 * Two adjacent x-clusters are only a real column boundary if the cells either side are
 * separated by a visible gutter. Without this, "Marcus Bell" reads as two columns purely
 * because first names happen to be a similar width.
 */
function mergeTightColumns(lines: OcrWord[][], columns: number[], charWidth: number): number[] {
  if (columns.length < 2) return columns
  const gutter = charWidth * 2.2

  const kept = [columns[0]]
  for (let c = 1; c < columns.length; c++) {
    const gaps: number[] = []
    for (const line of lines) {
      const left = line.filter(
        (w) => w.bbox.x < columns[c] - charWidth && w.bbox.x >= kept[kept.length - 1] - charWidth
      )
      const right = line.filter((w) => w.bbox.x >= columns[c] - charWidth)
      if (left.length === 0 || right.length === 0) continue
      const leftEnd = Math.max(...left.map((w) => w.bbox.x + w.bbox.width))
      const rightStart = Math.min(...right.map((w) => w.bbox.x))
      gaps.push(rightStart - leftEnd)
    }
    if (gaps.length === 0) {
      kept.push(columns[c])
      continue
    }
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    if (median >= gutter) kept.push(columns[c])
  }
  return kept
}

function buildRows(
  lines: OcrWord[][],
  columns: number[],
  tolerance: number
): { rows: string[][]; used: OcrWord[][] } {
  const rows: string[][] = []
  const used: OcrWord[][] = []
  for (const line of lines) {
    const cells: string[] = new Array(columns.length).fill('')
    let filled = 0
    for (const word of line) {
      let index = 0
      for (let c = columns.length - 1; c >= 0; c--) {
        if (word.bbox.x >= columns[c] - tolerance) {
          index = c
          break
        }
      }
      if (!cells[index]) filled++
      cells[index] = cells[index] ? `${cells[index]} ${word.text}` : word.text
    }
    if (filled >= Math.max(2, Math.ceil(columns.length * 0.6))) {
      rows.push(cells.map((c) => c.trim()))
      used.push(line)
    } else {
      rows.push([])
      used.push([])
    }
  }
  return { rows, used }
}

/**
 * Look for a grid in the word boxes.
 *
 * Screenshots of tables have a giveaway: a *run of consecutive lines* whose words start
 * at the same handful of x positions. Searching runs rather than the whole page is what
 * stops a sidebar and a page heading from being read as extra rows and columns.
 */
export function detectTable(ocr: OcrResult): DetectedTable | null {
  const confidentWords = ocr.words.filter(
    (word) => word.confidence >= 68 && meaningfulCharacterRatio(word.text) >= 0.65
  )
  const allLines = toLines(confidentWords).filter(
    (line) => line.length >= 2 && averageConfidence(line) >= 72
  )
  if (allLines.length < 3) return null

  const widths = ocr.words
    .map((w) => w.bbox.width / Math.max(1, w.text.length))
    .sort((a, b) => a - b)
  const charWidth = widths[Math.floor(widths.length / 2)] || 8
  const tolerance = Math.max(10, charWidth * 2.5)

  let best: { rows: string[][]; columns: number; words: OcrWord[]; score: number } | null = null

  for (let start = 0; start < allLines.length - 2; start++) {
    for (let end = start + 2; end < allLines.length; end++) {
      const run = allLines.slice(start, end + 1)

      // Table rows are evenly spaced; a big jump means we've left the table.
      const gaps: number[] = []
      for (let i = 1; i < run.length; i++) gaps.push(run[i][0].bbox.y - run[i - 1][0].bbox.y)
      const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 1
      if (gaps.some((g) => g > median * 2.6 || g <= 0)) break

      const columns = mergeTightColumns(run, clusterColumns(run, tolerance, 0.7), charWidth)
      if (columns.length < 2) continue

      const { rows, used } = buildRows(run, columns, tolerance)
      const solid = rows.filter((r) => r.length > 0)
      if (solid.length < 3) continue

      // Prefer wide *and* tall; a two-column run of prose shouldn't beat a real table.
      const score = solid.length * columns.length * columns.length
      if (!best || score > best.score) {
        best = {
          rows: solid,
          columns: columns.length,
          words: used.flat(),
          score
        }
      }
    }
  }

  if (!best || best.columns < 2) return null

  const escape = (cell: string) => cell.replace(/\|/g, '\\|')
  const markdown = [
    `| ${best.rows[0].map(escape).join(' | ')} |`,
    `| ${best.rows[0].map(() => '---').join(' | ')} |`,
    ...best.rows.slice(1).map((r) => `| ${r.map(escape).join(' | ')} |`)
  ].join('\n')

  const csv = best.rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    .join('\n')

  return {
    rows: best.rows,
    markdown,
    csv,
    columns: best.columns,
    bbox: unionBox(best.words)
  }
}

/* ------------------------------------------------------------------ *
 * Title suggestion
 * ------------------------------------------------------------------ */

/**
 * The biggest line of text in the upper part of the capture is almost always its
 * heading — which beats "ClipThat 2026-08-05 at 21.04.11" as a filename.
 */
export function suggestTitle(ocr: OcrResult, imageHeight: number): string | null {
  const lines = toLines(ocr.words)
  if (lines.length === 0) return null

  let best: { score: number; text: string } | null = null
  for (const line of lines) {
    const box = unionBox(line)
    if (box.y > imageHeight * 0.55) continue
    const text = line
      // OCR loves to emit stray punctuation next to headings; it isn't part of the title.
      .filter((w) => w.confidence >= 60 && /[A-Za-z0-9]/.test(w.text))
      .map((w) => w.text)
      .join(' ')
      .replace(/^[^\w]+|[^\w)\]]+$/g, '')
      .trim()
    if (text.length < 3 || text.length > 60) continue
    if (!/[A-Za-z]/.test(text)) continue
    if (/[@:/#]/.test(text)) continue // addresses and labels aren't titles
    const confidence = line.reduce((a, w) => a + w.confidence, 0) / line.length
    if (confidence < 70) continue
    const score = box.height * (1 - box.y / Math.max(1, imageHeight)) * 1.4
    if (!best || score > best.score) best = { score, text }
  }

  if (!best) return null
  return (
    best.text
      .replace(/\s+/g, ' ')
      .replace(/[\\/:*?"<>|]/g, '')
      .slice(0, 60)
      .trim() || null
  )
}

/* ------------------------------------------------------------------ *
 * Colour palette
 * ------------------------------------------------------------------ */

export interface Swatch {
  hex: string
  share: number
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`

/**
 * Dominant colours in the capture. Downsamples hard, buckets into a coarse RGB grid,
 * then merges buckets that are too close to read as different swatches.
 */
export function extractPalette(image: HTMLImageElement, count = 6): Swatch[] {
  const maxSide = 180
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight, 1))
  const w = Math.max(1, Math.round(image.naturalWidth * scale))
  const h = Math.max(1, Math.round(image.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(image, 0, 0, w, h)

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, w, h).data
  } catch {
    return []
  }

  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const cell = buckets.get(key)
    if (cell) {
      cell.r += r
      cell.g += g
      cell.b += b
      cell.n++
    } else {
      buckets.set(key, { r, g, b, n: 1 })
    }
  }

  const total = [...buckets.values()].reduce((a, c) => a + c.n, 0) || 1
  const ranked = [...buckets.values()]
    .map((c) => ({ r: c.r / c.n, g: c.g / c.n, b: c.b / c.n, share: c.n / total }))
    .sort((a, b) => b.share - a.share)

  const picked: Array<{ r: number; g: number; b: number; share: number }> = []
  for (const candidate of ranked) {
    if (picked.length >= count) break
    const tooClose = picked.some(
      (p) =>
        Math.abs(p.r - candidate.r) + Math.abs(p.g - candidate.g) + Math.abs(p.b - candidate.b) < 60
    )
    if (!tooClose) picked.push(candidate)
  }

  return picked.map((p) => ({ hex: toHex(p.r, p.g, p.b), share: p.share }))
}
