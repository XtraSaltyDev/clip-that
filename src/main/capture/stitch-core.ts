/**
 * Scroll-stitching maths, with no Electron dependency so it can be tested directly.
 * `stitch.ts` wraps this with PNG decode/encode.
 */

export interface Frame {
  /** BGRA, row-major — the layout `nativeImage.toBitmap()` returns. */
  data: Buffer | Uint8Array
  width: number
  height: number
}

/**
 * Mean absolute difference between a horizontal band of `a` starting at `ay`
 * and one of `b` starting at `by`. Rows and columns are subsampled — full-fidelity
 * comparison buys nothing and costs a lot on a 5K frame.
 */
export function bandDiff(
  a: Frame,
  ay: number,
  b: Frame,
  by: number,
  bandHeight: number,
  colStep: number
): number {
  const w = Math.min(a.width, b.width)
  let sum = 0
  let count = 0
  for (let row = 0; row < bandHeight; row += 2) {
    const aOff = (ay + row) * a.width * 4
    const bOff = (by + row) * b.width * 4
    for (let x = 0; x < w; x += colStep) {
      const ai = aOff + x * 4
      const bi = bOff + x * 4
      sum +=
        Math.abs(a.data[ai] - b.data[bi]) +
        Math.abs(a.data[ai + 1] - b.data[bi + 1]) +
        Math.abs(a.data[ai + 2] - b.data[bi + 2])
      count += 3
    }
  }
  return count === 0 ? Number.POSITIVE_INFINITY : sum / count
}

/**
 * Where a band lifted from `next` at `templateY` sits in `prev`, or null if the match
 * isn't trustworthy. Content only ever moves up between frames, so the template can only
 * be found at or below its own position in the previous frame — which also caps the
 * largest scroll this template can measure at `h - bandHeight - templateY`.
 */
function matchTemplate(
  prev: Frame,
  next: Frame,
  templateY: number,
  bandHeight: number,
  h: number,
  colStep: number
): number | null {
  if (templateY + bandHeight >= h) return null

  let bestY = -1
  let bestScore = Number.POSITIVE_INFINITY
  let secondBest = Number.POSITIVE_INFINITY

  for (let y = templateY; y <= h - bandHeight; y++) {
    const score = bandDiff(prev, y, next, templateY, bandHeight, colStep)
    if (score < bestScore) {
      secondBest = bestScore
      bestScore = score
      bestY = y
    } else if (score < secondBest) {
      secondBest = score
    }
  }

  if (bestY < 0) return null

  // Reject weak matches: a real overlap is dramatically better than any other offset.
  const distinct = secondBest === Number.POSITIVE_INFINITY || bestScore < secondBest * 0.75
  if (bestScore > 18 && !distinct) return null

  return Math.max(0, bestY - templateY)
}

/** Fractions of the frame height to lift comparison templates from. */
const TEMPLATE_POSITIONS = [0.25, 0.55]

/**
 * How far `next` scrolled relative to `prev`, in pixels (positive = content moved up).
 *
 * Two templates are tried. The lower one (55%) is what survives sticky headers and
 * floating chrome, which are identical in every frame and would otherwise pin the match
 * at zero. The higher one (25%) leaves more of `prev` below it to search, which is what
 * lets a fast scroll — up to about 70% of the viewport per frame — still be measured.
 *
 * Of the templates that produce a trustworthy match we take the **largest** offset: a
 * template that landed inside repeated chrome reports zero, and a genuine match never
 * reports less than the truth.
 *
 * Returns null when no template matched well enough to trust.
 */
export function estimateScroll(prev: Frame, next: Frame): number | null {
  const h = Math.min(prev.height, next.height)
  const bandHeight = Math.max(24, Math.min(80, Math.round(h * 0.08)))
  const colStep = Math.max(1, Math.round(prev.width / 240))

  let best: number | null = null
  for (const ratio of TEMPLATE_POSITIONS) {
    const dy = matchTemplate(prev, next, Math.round(h * ratio), bandHeight, h, colStep)
    if (dy === null) continue
    if (best === null || dy > best) best = dy
  }

  return best
}

export interface StitchPlan {
  /** Scroll distance contributed by each frame after the first. */
  offsets: number[]
  totalHeight: number
  framesUsed: number
}

/** Work out how tall the stitched result is and how much each frame contributes. */
export function planStitch(frames: Frame[]): StitchPlan {
  if (frames.length === 0) return { offsets: [], totalHeight: 0, framesUsed: 0 }

  const height = frames[0].height
  const offsets: number[] = []
  for (let i = 1; i < frames.length; i++) {
    const dy = estimateScroll(frames[i - 1], frames[i])
    // A frame that didn't move (or couldn't be matched) contributes nothing.
    offsets.push(dy && dy > 2 ? dy : 0)
  }

  return {
    offsets,
    totalHeight: height + offsets.reduce((a, b) => a + b, 0),
    framesUsed: 1 + offsets.filter((d) => d > 0).length
  }
}

/** Paint the frames into one tall BGRA buffer using a plan from `planStitch`. */
export function composite(frames: Frame[], plan: StitchPlan): Buffer {
  const { width, height } = frames[0]
  const out = Buffer.alloc(width * plan.totalHeight * 4)
  Buffer.from(frames[0].data.buffer, frames[0].data.byteOffset, width * height * 4).copy(out, 0)

  let cursor = height
  for (let i = 1; i < frames.length; i++) {
    const dy = plan.offsets[i - 1]
    if (dy <= 0) continue
    // Only the newly revealed strip at the bottom of this frame is new content.
    const src = Buffer.from(frames[i].data.buffer, frames[i].data.byteOffset, width * height * 4)
    src.copy(out, cursor * width * 4, (height - dy) * width * 4, height * width * 4)
    cursor += dy
  }
  return out
}
