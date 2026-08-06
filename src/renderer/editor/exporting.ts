import type Konva from 'konva'
import { useEditor } from './store'

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/**
 * Flatten the current document to a data URL.
 *
 * The stage is rendered at 1:1 rather than at the on-screen zoom, so cached filter nodes
 * (blur, pixelate) rebuild at full resolution and the export matches the preview exactly.
 */
export async function flatten(
  stage: Konva.Stage | null,
  options: { mimeType?: string; quality?: number } = {}
): Promise<string | null> {
  if (!stage) return null

  const state = useEditor.getState()
  const prevZoom = state.zoom
  const prevAutoFit = state.autoFit
  const prevSelection = state.selectedIds
  const prevTool = state.tool

  state.select([])
  if (prevTool === 'crop') state.setTool('select')
  state.setZoom(1, false)

  // Two frames: one for React to re-render at scale 1, one for Konva to re-cache filters.
  await raf()
  await raf()

  let url: string | null = null
  try {
    url = stage.toDataURL({
      pixelRatio: 1,
      mimeType: options.mimeType ?? 'image/png',
      quality: options.quality
    })
  } catch (err) {
    console.error('[export] toDataURL failed', err)
  }

  state.setZoom(prevZoom, prevAutoFit)
  state.select(prevSelection)
  state.setTool(prevTool)
  await raf()

  return url
}

/** Re-encode a PNG data URL as JPEG or WebP, which Konva can't emit with a background. */
export async function encodeAs(
  dataUrl: string,
  format: 'png' | 'jpg' | 'webp',
  quality = 0.92,
  matte = '#ffffff'
): Promise<string> {
  if (format === 'png') return dataUrl

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('decode failed'))
    el.src = dataUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  // JPEG has no alpha, so transparent padding would come out black without a matte.
  if (format === 'jpg') {
    ctx.fillStyle = matte
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL(format === 'jpg' ? 'image/jpeg' : 'image/webp', quality)
}

export function dataUrlSize(dataUrl: string): number {
  const i = dataUrl.indexOf(',')
  if (i === -1) return 0
  const base64 = dataUrl.slice(i + 1)
  return Math.round((base64.length * 3) / 4)
}
