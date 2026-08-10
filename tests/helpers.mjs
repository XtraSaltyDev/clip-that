import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

export const load = (name) => import(pathToFileURL(join(root, '.cache/test', `${name}.js`)).href)

export const fixture = (name) =>
  JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8'))

let nextY = 0

/**
 * Build an OCR word from a text string and a box. Character width is fixed so the
 * table detector's gutter maths is predictable in tests.
 */
export function word(text, x, y, { height = 16, charWidth = 8, confidence = 95 } = {}) {
  return {
    text,
    confidence,
    bbox: { x, y, width: text.length * charWidth, height }
  }
}

/**
 * Lay a row of cells out at fixed x positions. Returns the words for that row.
 *
 *   row(100, [[0, 'INV-1'], [200, 'Marcus Bell']])
 */
export function row(y, cells, opts = {}) {
  return cells.map(([x, text]) => word(text, x, y, opts))
}

/** Assemble an OcrResult from word arrays. */
export function ocr(...groups) {
  const words = groups.flat()
  return { text: words.map((w) => w.text).join(' '), words }
}

/** A single line of words spaced one character apart, starting at x. */
export function line(text, { x = 0, y, height = 16, charWidth = 8, confidence = 95 } = {}) {
  const at = y ?? (nextY += height + 8)
  const words = []
  let cursor = x
  for (const token of text.split(' ')) {
    words.push(word(token, cursor, at, { height, charWidth, confidence }))
    cursor += (token.length + 1) * charWidth
  }
  return words
}

export const resetLines = () => {
  nextY = 0
}

/* ------------------------------------------------------------------ *
 * Synthetic scroll frames
 * ------------------------------------------------------------------ */

/**
 * Build a tall BGRA "page" with horizontally-striped rows whose colour varies by y,
 * so any vertical offset is unambiguous, plus an optional sticky header band that is
 * identical in every frame.
 */
export function makePage(width, height, { stickyHeader = 0 } = {}) {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sticky = y < stickyHeader
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      // A pseudo-random but deterministic value per row keeps rows distinguishable.
      const v = sticky ? 200 : (y * 37 + 11) % 251
      data[i] = v
      data[i + 1] = (v * 3) % 251
      data[i + 2] = (v * 7) % 251
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

/** Take a viewport-sized frame out of a page at scroll offset `top`. */
export function viewport(page, top, height, { stickyHeader = 0 } = {}) {
  const { width } = page
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sourceY = y < stickyHeader ? y : Math.min(page.height - 1, top + y)
    page.data.copy(data, y * width * 4, sourceY * width * 4, (sourceY + 1) * width * 4)
  }
  return { data, width, height }
}
