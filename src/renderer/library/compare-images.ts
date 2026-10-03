import { comparisonSize, type ImageComparison } from '@shared/image-compare'
import type { LibraryItem } from '@shared/types'
import { api } from '../shared/api'

export interface ComparisonFrames {
  before: HTMLCanvasElement
  after: HTMLCanvasElement
  width: number
  height: number
  scale: number
  beforeSize: { width: number; height: number }
  afterSize: { width: number; height: number }
}

async function loadCapture(item: LibraryItem, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(api.library.fileUrl(item.filePath), { signal })
  if (!response.ok) throw new Error(`“${item.title}” is missing or could not be read.`)
  const image = await createImageBitmap(await response.blob())
  if (signal.aborted) {
    image.close()
    throw new DOMException('Comparison cancelled', 'AbortError')
  }
  return image
}

export async function loadComparison(
  before: LibraryItem,
  after: LibraryItem,
  signal: AbortSignal
): Promise<ComparisonFrames> {
  // allSettled ensures a successfully decoded bitmap is closed when the other one fails.
  const loaded = await Promise.allSettled([loadCapture(before, signal), loadCapture(after, signal)])
  try {
    const first = loaded[0],
      second = loaded[1]
    if (first.status === 'rejected') throw first.reason
    if (second.status === 'rejected') throw second.reason
    const beforeSize = { width: first.value.width, height: first.value.height }
    const afterSize = { width: second.value.width, height: second.value.height }
    const size = comparisonSize(beforeSize, afterSize)
    const draw = (image: ImageBitmap) => {
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('The comparison canvas could not be created.')
      context.drawImage(
        image,
        0,
        0,
        Math.max(1, Math.floor(image.width * size.scale)),
        Math.max(1, Math.floor(image.height * size.scale))
      )
      return canvas
    }
    return { ...size, before: draw(first.value), after: draw(second.value), beforeSize, afterSize }
  } finally {
    for (const image of loaded) if (image.status === 'fulfilled') image.value.close()
  }
}

export type ComparisonMode = 'wipe' | 'overlay' | 'difference' | 'before' | 'after'

export function drawComparison(
  canvas: HTMLCanvasElement,
  frames: ComparisonFrames,
  mode: ComparisonMode,
  amount: number,
  result: ImageComparison | null,
  selectedRegion = -1
): void {
  canvas.width = frames.width
  canvas.height = frames.height
  const context = canvas.getContext('2d')!
  if (mode === 'difference' && !result) return
  if (mode === 'difference' && result) {
    context.putImageData(
      new ImageData(new Uint8ClampedArray(result.heatmap), frames.width, frames.height),
      0,
      0
    )
  } else if (mode === 'before' || mode === 'after') {
    context.drawImage(frames[mode], 0, 0)
  } else {
    context.drawImage(frames.after, 0, 0)
    context.save()
    if (mode === 'wipe') {
      context.beginPath()
      context.rect(0, 0, (frames.width * amount) / 100, frames.height)
      context.clip()
      context.clearRect(0, 0, frames.width, frames.height)
    } else context.globalAlpha = amount / 100
    context.drawImage(frames.before, 0, 0)
    context.restore()
    if (mode === 'wipe') {
      context.strokeStyle = '#ffffff'
      context.lineWidth = Math.max(2, frames.width / 600)
      context.beginPath()
      context.moveTo((frames.width * amount) / 100, 0)
      context.lineTo((frames.width * amount) / 100, frames.height)
      context.stroke()
    }
  }
  if (selectedRegion >= 0 && result?.regions[selectedRegion]) {
    const region = result.regions[selectedRegion]
    const lineWidth = Math.max(2, frames.width / 500)
    context.lineWidth = lineWidth * 2
    context.strokeStyle = '#ffffff'
    context.strokeRect(region.x, region.y, region.width, region.height)
    context.lineWidth = lineWidth
    context.strokeStyle = '#d41455'
    context.strokeRect(region.x, region.y, region.width, region.height)
  }
}

export function comparisonReport(
  frames: ComparisonFrames,
  result: ImageComparison,
  before: LibraryItem,
  after: LibraryItem,
  mode: ComparisonMode,
  amount: number,
  threshold: number
): string {
  const header = 116
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(720, frames.width)
  canvas.height = frames.height + header
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const preview = document.createElement('canvas')
  drawComparison(preview, frames, mode, amount, result)
  context.drawImage(preview, (canvas.width - frames.width) / 2, header)
  context.fillStyle = '#161c2a'
  context.font = 'bold 22px system-ui'
  context.fillText('ClipThat · Capture comparison', 24, 32, canvas.width - 48)
  context.font = '14px system-ui'
  context.fillText(
    `Before: ${before.title} (${frames.beforeSize.width}×${frames.beforeSize.height})`,
    24,
    57,
    canvas.width - 48
  )
  context.fillText(
    `After: ${after.title} (${frames.afterSize.width}×${frames.afterSize.height})`,
    24,
    78,
    canvas.width - 48
  )
  context.fillText(
    `${result.changedPercent.toFixed(2)}% changed · ${result.regions.length} regions · tolerance ${threshold} · ${mode} · analysis ${frames.width}×${frames.height}`,
    24,
    101,
    canvas.width - 48
  )
  return canvas.toDataURL('image/png')
}
