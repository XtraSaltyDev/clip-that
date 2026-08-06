import jsQR from 'jsqr'

/**
 * Offline QR decoding for the screen-context engine. Point a capture at a QR code and
 * get the URL out — no camera, no network.
 */

/** Decode raw RGBA pixels. Pure, so the round-trip is unit-testable in Node. */
export function decodeQrRgba(data: Uint8ClampedArray, width: number, height: number): string | null {
  try {
    const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })
    const text = result?.data?.trim()
    return text || null
  } catch {
    return null
  }
}

/**
 * Decode from a loaded image. Tries a downscaled pass first (fast, and jsQR actually
 * prefers moderate sizes), then full resolution for codes that are small on screen.
 */
export function decodeQrFromImage(image: HTMLImageElement): string | null {
  for (const maxSide of [1000, 2200]) {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight, 1))
    const w = Math.max(1, Math.round(image.naturalWidth * scale))
    const h = Math.max(1, Math.round(image.naturalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(image, 0, 0, w, h)

    try {
      const { data } = ctx.getImageData(0, 0, w, h)
      const text = decodeQrRgba(data, w, h)
      if (text) return text
    } catch {
      return null
    }
    // A second pass only helps when the first was actually downscaled.
    if (scale === 1) break
  }
  return null
}

export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim()) || /^www\.\S+\.\S+/i.test(text.trim())
}
