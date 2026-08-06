import { createWorker, type Worker } from 'tesseract.js'
import type { OcrResult, OcrWord, Rect } from '@shared/types'

/**
 * Tesseract runs entirely from files we ship — the worker script, the WASM core and the
 * English model all live next to the renderer bundle, so OCR works with no network at all.
 */
const assets = (file: string) => new URL(`./ocr/${file}`, window.location.href).href

let workerPromise: Promise<Worker> | null = null

async function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker('eng', 1, {
    workerPath: assets('worker.min.js'),
    corePath: new URL('./ocr/', window.location.href).href,
    langPath: new URL('./ocr/', window.location.href).href,
    gzip: true,
    // Tesseract calls this unconditionally, so it has to be a function — but progress
    // logging costs a postMessage per tick and we don't surface it.
    logger: () => {}
  })
  return workerPromise
}

/**
 * Recognise text in a data URL, optionally limited to a rectangle.
 * Small crops are upscaled first — Tesseract's accuracy falls off a cliff below ~20px glyphs.
 */
export async function runOcr(dataUrl: string, rect?: Rect): Promise<OcrResult> {
  const source = rect ? await cropAndScale(dataUrl, rect) : dataUrl
  const worker = await getWorker()
  const { data } = await worker.recognize(source)

  const words: OcrWord[] = []
  const blocks = (
    data as unknown as {
      words?: Array<{
        text: string
        confidence: number
        bbox: { x0: number; y0: number; x1: number; y1: number }
      }>
    }
  ).words

  for (const w of blocks ?? []) {
    if (!w.text?.trim()) continue
    words.push({
      text: w.text,
      confidence: w.confidence,
      bbox: {
        x: w.bbox.x0,
        y: w.bbox.y0,
        width: w.bbox.x1 - w.bbox.x0,
        height: w.bbox.y1 - w.bbox.y0
      }
    })
  }

  return { text: data.text ?? '', words }
}

/** Scale factor `runOcr` applies to a region, so callers can map boxes back. */
export function ocrScaleFor(rect?: Rect): number {
  return rect && rect.height < 240 ? 2 : 1
}

async function cropAndScale(dataUrl: string, rect: Rect): Promise<string> {
  const img = await loadImage(dataUrl)
  const scale = ocrScaleFor(rect)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.width * scale))
  canvas.height = Math.max(1, Math.round(rect.height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image failed to load'))
    img.src = src
  })
}

/** Shift OCR boxes from a scaled crop back into full-image coordinates. */
export function toImageSpace(result: OcrResult, rect?: Rect): OcrResult {
  if (!rect) return result
  const scale = ocrScaleFor(rect)
  return {
    text: result.text,
    words: result.words.map((w) => ({
      ...w,
      bbox: {
        x: rect.x + w.bbox.x / scale,
        y: rect.y + w.bbox.y / scale,
        width: w.bbox.width / scale,
        height: w.bbox.height / scale
      }
    }))
  }
}

// Analysis lives in extract.ts; re-exported here so callers have one obvious import.
export { findSensitive, SENSITIVE_LABELS } from './extract'
