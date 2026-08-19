import { ipcMain, type IpcMainEvent } from 'electron'
import { IPC } from '@shared/ipc'
import { promises as fs } from 'node:fs'
import { extname } from 'node:path'
import type { OcrResult, Rect } from '@shared/types'
import { closeWorkerWindow, getWorkerWindow } from './windows/manager'
import { library } from './store/library'
import { settings } from './store/settings'
import { assertIpcSender } from './ipc/sender'
import { ocrResponse } from './ipc/validation'
import { needsOcrUpgrade, trustedOcrText } from './store/library-ocr'

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
export async function requestOcr(
  dataUrl: string,
  rect?: Rect,
  timeoutMs = 90_000
): Promise<OcrResult> {
  beginOcrRequest()
  try {
    const worker = await getWorkerWindow()
    const id = `ocr-${++sequence}`

    return await new Promise<OcrResult>((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        clearTimeout(timer)
        ipcMain.removeListener(IPC.ocrResult, onResult)
        worker.webContents.removeListener('render-process-gone', onGone)
        worker.removeListener('closed', onClosed)
      }
      const succeed = (result: OcrResult) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const timer = setTimeout(() => succeed({ text: '', words: [] }), timeoutMs)

      const onResult = (event: IpcMainEvent, payload: unknown) => {
        let safe: ReturnType<typeof ocrResponse>
        try {
          assertIpcSender(event, ['worker'])
          safe = ocrResponse(payload)
        } catch {
          return
        }
        if (safe.id !== id) return
        succeed(safe.result)
      }

      const onGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) =>
        fail(new Error(`OCR worker renderer exited: ${details.reason}`))
      const onClosed = () => fail(new Error('OCR worker window closed during recognition'))

      ipcMain.on(IPC.ocrResult, onResult)
      worker.webContents.once('render-process-gone', onGone)
      worker.once('closed', onClosed)
      try {
        worker.webContents.send(IPC.ocrRequest, { id, dataUrl, rect })
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
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
const failedThisRun = new Set<string>()
let running = false
let backlogTimer: NodeJS.Timeout | null = null
const BACKLOG_BATCH = 200

/**
 * Read every capture's text so the library is searchable by what's *in* the picture,
 * not just its filename. Runs one at a time in the background; a capture the user never
 * opened in the editor still ends up indexed.
 */
export function indexCapture(id: string): void {
  if (!settings.get().autoOcr) return
  failedThisRun.delete(id)
  if (queue.includes(id)) return
  queue.push(id)
  void drain()
}

/** Catch up on anything that predates this feature, or that failed earlier. */
export function indexBacklog(): void {
  if (!settings.get().autoOcr) return
  if (backlogTimer) clearTimeout(backlogTimer)
  backlogTimer = null
  const pending = library.ocrUpgradeBatch(BACKLOG_BATCH, failedThisRun)
  for (const item of pending) {
    if (!queue.includes(item.id)) queue.push(item.id)
  }
  void drain()
}

async function drain(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length > 0) {
      if (!settings.get().autoOcr) {
        queue.length = 0
        break
      }
      const id = queue.shift()!
      const item = library.get(id)
      if (!item || !needsOcrUpgrade(item)) continue

      try {
        const mime = MIME[extname(item.filePath).toLowerCase()] ?? 'image/png'
        const buffer = await fs.readFile(item.filePath)
        const result = await requestOcr(`data:${mime};base64,${buffer.toString('base64')}`)
        // Store even an empty result: it marks the item as "already looked at".
        library.updateOcrIndex(id, trustedOcrText(result))
      } catch (err) {
        failedThisRun.add(id)
        console.error('[ocr-index] failed for', id, err)
      }

      // Be a good citizen — indexing must never compete with an active capture.
      await new Promise((r) => setTimeout(r, 400))
    }
  } finally {
    running = false
    if (settings.get().autoOcr && library.ocrUpgradeBatch(1, failedThisRun).length > 0) {
      backlogTimer = setTimeout(indexBacklog, 1_000)
    }
  }
}
