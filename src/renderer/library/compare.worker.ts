import { compareImages } from '@shared/image-compare'

self.onmessage = (
  event: MessageEvent<{
    before: Uint8ClampedArray
    after: Uint8ClampedArray
    width: number
    height: number
    threshold: number
  }>
) => {
  try {
    const { before, after, width, height, threshold } = event.data
    const result = compareImages(before, after, width, height, threshold)
    self.postMessage({ result }, { transfer: [result.heatmap.buffer] })
  } catch (error) {
    self.postMessage({ error: (error as Error).message })
  }
}
