import { nativeImage } from 'electron'
import { composite, planStitch, type Frame } from './stitch-core'

export { estimateScroll } from './stitch-core'

function toFrame(dataUrl: string): Frame | null {
  const image = nativeImage.createFromDataURL(dataUrl)
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
export function stitchFrames(dataUrls: string[]): StitchResult | null {
  const decoded = dataUrls.map(toFrame).filter((f): f is Frame => f !== null)
  if (decoded.length === 0) return null

  const { width, height } = decoded[0]
  const frames = decoded.filter((f) => f.width === width && f.height === height)
  if (frames.length === 0) return null
  if (frames.length === 1) {
    return { dataUrl: dataUrls[0], width, height, framesUsed: 1 }
  }

  const plan = planStitch(frames)
  if (plan.totalHeight <= height) {
    return { dataUrl: dataUrls[0], width, height, framesUsed: 1 }
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
