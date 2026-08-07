import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { extname } from 'node:path'
import type { Rect } from '@shared/types'
import { closeWorkerWindow, getWorkerWindow } from './windows/manager'
import { library } from './store/library'
import { settings } from './store/settings'

let sequence = 0
let activeRequests = 0
let idleTimer: NodeJS.Timeout | null = null

// Batch indexing arrives 400ms apart, so it continues to share one warm Tesseract model.
// A user who is finished capturing should not pay for that 100+ MiB worker indefinitely.
const OCR_IDLE_MS = 30_000

function beginOcrRequest(): void {
  activeRequests += 1
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
}

function finishOcrRequest(): void {
  activeRequests = Math.max(0, activeRequests - 1)
  if (activeRequests > 0) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (activeRequests === 0) closeWorkerWindow()
  }, OCR_IDLE_MS)
}

/**
 * Run OCR in the hidden worker renderer. The main process has no DOM and no WASM host,
 * so every text-recognition request in the app funnels through here.
 */
export async function requestOcr(dataUrl: string, rect?: Rect, timeoutMs = 90_000): Promise<string> {
  beginOcrRequest()
  try {
    const worker = await getWorkerWindow()
    const id = `ocr-${++sequence}`

    return await new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        ipcMain.removeListener('ocr:result', onResult)
        resolve('')
      }, timeoutMs)

      const onResult = (_e: unknown, payload: { id: string; text: string }) => {
        if (payload.id !== id) return
        clearTimeout(timer)
        ipcMain.removeListener('ocr:result', onResult)
        resolve(payload.text)
      }

      ipcMain.on('ocr:result', onResult)
      worker.webContents.send('ocr:request', { id, dataUrl, rect })
    })
  } finally {
    finishOcrRequest()
  }
}

/* ------------------------------------------------------------------ *
 * Library indexing
 * ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

const queue: string[] = []
let running = false

/**
 * Read every capture's text so the library is searchable by what's *in* the picture,
 * not just its filename. Runs one at a time in the background; a capture the user never
 * opened in the editor still ends up indexed.
 */
export function indexCapture(id: string): void {
  if (!settings.get().autoOcr) return
  if (queue.includes(id)) return
  queue.push(id)
  void drain()
}

/** Catch up on anything that predates this feature, or that failed earlier. */
export function indexBacklog(): void {
  if (!settings.get().autoOcr) return
  const pending = library
    .list({ kind: 'image', limit: 100000 })
    .filter((item) => item.ocrText === undefined)
    .slice(0, 200)
  for (const item of pending) indexCapture(item.id)
}

async function drain(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length > 0) {
      const id = queue.shift()!
      const item = library.get(id)
      if (!item || item.kind !== 'image' || item.ocrText !== undefined) continue

      try {
        const mime = MIME[extname(item.filePath).toLowerCase()] ?? 'image/png'
        const buffer = await fs.readFile(item.filePath)
        const text = await requestOcr(`data:${mime};base64,${buffer.toString('base64')}`)
        // Store even an empty result: it marks the item as "already looked at".
        library.update(id, { ocrText: text.trim() })
      } catch (err) {
        console.error('[ocr-index] failed for', id, err)
      }

      // Be a good citizen — indexing must never compete with an active capture.
      await new Promise((r) => setTimeout(r, 400))
    }
  } finally {
    running = false
  }
}
