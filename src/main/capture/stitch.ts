import { nativeImage } from 'electron'
import { composite, planStitch, type Frame } from './stitch-core'

export { estimateScroll } from './stitch-core'

function toFrame(source: string | Buffer): Frame | null {
  const image = typeof source === 'string'
    ? nativeImage.createFromDataURL(source)
    : nativeImage.createFromBuffer(source)
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  return { data: image.toBitmap(), width, height }
}

export interface StitchResult {
  dataUrl: string
  width: number
  height: number
  framesUsed: number
}

/**
 * Stitch scroll frames into one tall image.
 * Frames must be the same size and captured top-to-bottom while scrolling down.
 */
function stitchEncodedFrames(sources: Array<string | Buffer>): StitchResult | null {
  const decoded = sources.map(toFrame).filter((f): f is Frame => f !== null)
  if (decoded.length === 0) return null

  const { width, height } = decoded[0]
  const frames = decoded.filter((f) => f.width === width && f.height === height)
  if (frames.length === 0) return null
  if (frames.length === 1) {
    const image = nativeImage.createFromBitmap(Buffer.from(frames[0].data), { width, height })
    return { dataUrl: image.toDataURL(), width, height, framesUsed: 1 }
  }

  const plan = planStitch(frames)
  if (plan.totalHeight <= height) {
    const image = nativeImage.createFromBitmap(Buffer.from(frames[0].data), { width, height })
    return { dataUrl: image.toDataURL(), width, height, framesUsed: 1 }
  }

  const image = nativeImage.createFromBitmap(composite(frames, plan), {
    width,
    height: plan.totalHeight
  })
  return {
    dataUrl: image.toDataURL(),
    width,
    height: plan.totalHeight,
    framesUsed: plan.framesUsed
  }
}

export function stitchFrames(dataUrls: string[]): StitchResult | null {
  return stitchEncodedFrames(dataUrls)
}

/** Scroll capture stores compact PNG bytes instead of base64 strings between frames. */
export function stitchPngFrames(pngs: Buffer[]): StitchResult | null {
  return stitchEncodedFrames(pngs)
}
