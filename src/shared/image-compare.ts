import type { Rect } from './types'

export const COMPARE_MAX_PIXELS = 4_000_000
export const COMPARE_MAX_EDGE = 2400

export interface ChangeRegion extends Rect {
  pixels: number
}

export interface ImageComparison {
  width: number
  height: number
  comparedPixels: number
  changedPixels: number
  changedPercent: number
  regions: ChangeRegion[]
  heatmap: Uint8ClampedArray
}

/** One common scale preserves relative dimensions; smaller captures are never stretched. */
export function comparisonSize(
  before: { width: number; height: number },
  after: { width: number; height: number }
) {
  for (const size of [before, after]) {
    if (
      !Number.isInteger(size.width) ||
      !Number.isInteger(size.height) ||
      size.width < 1 ||
      size.height < 1
    )
      throw new Error('Both captures need valid image dimensions.')
  }
  const width = Math.max(before.width, after.width)
  const height = Math.max(before.height, after.height)
  const scale = Math.min(
    1,
    COMPARE_MAX_EDGE / width,
    COMPARE_MAX_EDGE / height,
    Math.sqrt(COMPARE_MAX_PIXELS / (width * height))
  )
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale
  }
}

/** Compare rendered RGBA pixels. Hidden RGB in transparent pixels never creates a change. */
export function compareImages(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 16
): ImageComparison {
  const count = width * height
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    count > COMPARE_MAX_PIXELS ||
    before.length !== count * 4 ||
    after.length !== count * 4
  )
    throw new Error('The comparison frame is invalid or too large.')
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255)
    throw new Error('Change tolerance must be between 0 and 255.')

  const heatmap = new Uint8ClampedArray(count * 4)
  const tile = 24
  const columns = Math.ceil(width / tile)
  const rows = Math.ceil(height / tile)
  const tiles = new Uint32Array(columns * rows)
  const bounds: Array<Rect | undefined> = new Array(tiles.length)
  let changedPixels = 0
  let comparedPixels = 0
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4
    const a = before[offset + 3] / 255
    const b = after[offset + 3] / 255
    let delta = Math.abs(before[offset + 3] - after[offset + 3])
    let luminance = 0
    for (let channel = 0; channel < 3; channel++) {
      const first = before[offset + channel] * a + 255 * (1 - a)
      const second = after[offset + channel] * b + 255 * (1 - b)
      delta = Math.max(delta, Math.abs(first - second))
      luminance += second / 3
    }
    const visible = a > 0 || b > 0
    if (visible) comparedPixels++
    const changed = visible && delta > threshold
    heatmap[offset] = changed ? 255 : luminance * 0.3 + 175
    heatmap[offset + 1] = changed ? 45 : luminance * 0.3 + 175
    heatmap[offset + 2] = changed ? 104 : luminance * 0.3 + 175
    heatmap[offset + 3] = visible ? 255 : 0
    if (!changed) continue
    changedPixels++
    const x = pixel % width
    const y = Math.floor(pixel / width)
    const index = Math.floor(y / tile) * columns + Math.floor(x / tile)
    tiles[index]++
    const bound = bounds[index]
    if (!bound) bounds[index] = { x, y, width: 1, height: 1 }
    else {
      const right = Math.max(bound.x + bound.width, x + 1)
      const bottom = Math.max(bound.y + bound.height, y + 1)
      bound.x = Math.min(bound.x, x)
      bound.y = Math.min(bound.y, y)
      bound.width = right - bound.x
      bound.height = bottom - bound.y
    }
  }

  const regions: ChangeRegion[] = []
  const seen = new Uint8Array(tiles.length)
  for (let start = 0; start < tiles.length; start++) {
    if (!tiles[start] || seen[start]) continue
    const queue = [start]
    seen[start] = 1
    let left = width,
      top = height,
      right = 0,
      bottom = 0,
      pixels = 0
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor]
      const bound = bounds[index]!
      left = Math.min(left, bound.x)
      top = Math.min(top, bound.y)
      right = Math.max(right, bound.x + bound.width)
      bottom = Math.max(bottom, bound.y + bound.height)
      pixels += tiles[index]
      const x = index % columns
      const y = Math.floor(index / columns)
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x + 1 < columns ? index + 1 : -1,
        y > 0 ? index - columns : -1,
        y + 1 < rows ? index + columns : -1
      ]
      for (const next of neighbours) {
        if (next < 0 || seen[next] || !tiles[next]) continue
        seen[next] = 1
        queue.push(next)
      }
    }
    regions.push({ x: left, y: top, width: right - left, height: bottom - top, pixels })
  }
  regions.sort((a, b) => b.pixels - a.pixels || a.y - b.y || a.x - b.x)
  return {
    width,
    height,
    changedPixels,
    comparedPixels,
    changedPercent: comparedPixels ? (changedPixels / comparedPixels) * 100 : 0,
    regions,
    heatmap
  }
}
