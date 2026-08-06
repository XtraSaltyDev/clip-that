import { nativeImage, screen, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import type { CaptureRequest, CaptureResult, ClipDocument, Rect } from '@shared/types'
import { formatFilename } from '@shared/defaults'
import { settings } from '../store/settings'
import { library } from '../store/library'
import { copyImageToClipboard, saveImage } from '../export'
import {
  broadcast,
  createEditorWindow,
  editorWindows,
  showHudWindow,
  showSettingsWindow,
  withAppWindowsHidden
} from '../windows/manager'
import { closeOverlay, openOverlay, takeFrozenSnapshot, type OverlaySelection } from '../windows/overlay'
import { captureDisplay, captureRegionCli, captureWindow, snapshotAllDisplays } from './backend'
import { displayUnderCursor, findDisplay } from './displays'
import { stitchFrames } from './stitch'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Crop a data URL by pixel rect. */
function cropDataUrl(dataUrl: string, rect: Rect): { dataUrl: string; width: number; height: number } | null {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) return null
  const size = image.getSize()
  const x = Math.max(0, Math.min(size.width - 1, Math.round(rect.x)))
  const y = Math.max(0, Math.min(size.height - 1, Math.round(rect.y)))
  const width = Math.max(1, Math.min(size.width - x, Math.round(rect.width)))
  const height = Math.max(1, Math.min(size.height - y, Math.round(rect.height)))
  const cropped = image.crop({ x, y, width, height })
  if (cropped.isEmpty()) return null
  return { dataUrl: cropped.toDataURL(), width, height }
}

function makeResult(
  dataUrl: string,
  width: number,
  height: number,
  source: CaptureRequest['mode'],
  extra: Partial<CaptureResult> = {}
): CaptureResult {
  return {
    id: randomUUID(),
    dataUrl,
    width,
    height,
    scaleFactor: 1,
    source,
    createdAt: Date.now(),
    ...extra
  }
}

export function documentFromCapture(result: CaptureResult): ClipDocument {
  const s = settings.get()
  return {
    version: 1,
    id: result.id,
    title: result.title?.trim() || formatFilename(s.filenameTemplate, new Date(result.createdAt)),
    createdAt: result.createdAt,
    updatedAt: result.createdAt,
    image: result.dataUrl,
    imageWidth: result.width,
    imageHeight: result.height,
    scaleFactor: result.scaleFactor,
    crop: { enabled: false, x: 0, y: 0, width: result.width, height: result.height },
    shapes: [],
    canvas: { ...s.canvasPreset }
  }
}

/* ------------------------------------------------------------------ *
 * Capture modes
 * ------------------------------------------------------------------ */

async function captureFromSelection(sel: OverlaySelection): Promise<CaptureResult | null> {
  if (sel.windowId) {
    const win = await captureWindow(sel.windowId)
    if (!win) return null
    return makeResult(win.dataUrl, win.width, win.height, 'window', { title: win.title })
  }

  // Crop the exact image the user drew their selection on. Re-photographing the screen
  // here — the original design — both broke the what-you-froze-is-what-you-get promise
  // and, worse, went through an API that sometimes returned a different display entirely.
  const snap = takeFrozenSnapshot(sel.displayId) ?? (await captureDisplay(sel.displayId))
  if (!snap) return null
  const cropped = cropDataUrl(snap.dataUrl, sel.rect)
  if (!cropped) return null

  settings.set({ lastRegion: { ...sel.screenRect, displayId: sel.displayId } })
  return makeResult(cropped.dataUrl, cropped.width, cropped.height, 'region', {
    origin: sel.screenRect
  })
}

async function captureLastRegion(): Promise<CaptureResult | null> {
  const last = settings.get().lastRegion
  if (!last) return null
  const display = last.displayId ? findDisplay(last.displayId) : undefined
  const target =
    display ?? screen.getDisplayMatching({ x: last.x, y: last.y, width: last.width, height: last.height })

  const snap = await captureDisplay(String(target.id))
  if (!snap) return null

  // lastRegion is stored in virtual-desktop DIPs; convert back to this display's pixels.
  const rect: Rect = {
    x: (last.x - target.bounds.x) * target.scaleFactor,
    y: (last.y - target.bounds.y) * target.scaleFactor,
    width: last.width * target.scaleFactor,
    height: last.height * target.scaleFactor
  }
  const cropped = cropDataUrl(snap.dataUrl, rect)
  if (!cropped) return null
  return makeResult(cropped.dataUrl, cropped.width, cropped.height, 'region', { origin: last })
}

async function captureWholeDesktop(): Promise<CaptureResult | null> {
  const snaps = await snapshotAllDisplays()
  if (snaps.length === 0) return null
  if (snaps.length === 1) {
    const s = snaps[0]
    return makeResult(s.dataUrl, s.pixelWidth, s.pixelHeight, 'fullscreen')
  }

  // Lay every display out side by side in virtual-desktop space, scaled to the
  // highest DPI present so nothing gets softened.
  const scale = Math.max(...snaps.map((s) => s.scaleFactor))
  const minX = Math.min(...snaps.map((s) => s.bounds.x))
  const minY = Math.min(...snaps.map((s) => s.bounds.y))
  const maxX = Math.max(...snaps.map((s) => s.bounds.x + s.bounds.width))
  const maxY = Math.max(...snaps.map((s) => s.bounds.y + s.bounds.height))
  const width = Math.round((maxX - minX) * scale)
  const height = Math.round((maxY - minY) * scale)

  const canvas = Buffer.alloc(width * height * 4)
  for (const snap of snaps) {
    const targetW = Math.round(snap.bounds.width * scale)
    const targetH = Math.round(snap.bounds.height * scale)
    let img = nativeImage.createFromDataURL(snap.dataUrl)
    const size = img.getSize()
    if (size.width !== targetW || size.height !== targetH) {
      img = img.resize({ width: targetW, height: targetH, quality: 'best' })
    }
    const bmp = img.toBitmap()
    const ox = Math.round((snap.bounds.x - minX) * scale)
    const oy = Math.round((snap.bounds.y - minY) * scale)
    for (let row = 0; row < targetH; row++) {
      const destY = oy + row
      if (destY < 0 || destY >= height) continue
      const srcStart = row * targetW * 4
      const destStart = (destY * width + ox) * 4
      const copyLen = Math.min(targetW * 4, (width - ox) * 4)
      if (copyLen > 0) bmp.copy(canvas, destStart, srcStart, srcStart + copyLen)
    }
  }

  const composed = nativeImage.createFromBitmap(canvas, { width, height })
  return makeResult(composed.toDataURL(), width, height, 'fullscreen')
}

/* ------------------------------------------------------------------ *
 * Scrolling capture
 * ------------------------------------------------------------------ */

interface ScrollSession {
  displayId: string
  /** Region in the display's pixel space (for the crop fallback path). */
  rect: Rect
  /** Same region in global desktop DIPs (drives the fast -R path on macOS). */
  dipRect?: Rect
  frames: string[]
  timer: NodeJS.Timeout | null
  busy: boolean
}

let scrollSession: ScrollSession | null = null

export function scrollCaptureActive(): boolean {
  return scrollSession !== null
}

export function scrollFrameCount(): number {
  return scrollSession?.frames.length ?? 0
}

async function grabScrollFrame(): Promise<void> {
  const session = scrollSession
  if (!session || session.busy) return
  session.busy = true
  try {
    if (process.platform === 'darwin' && session.dipRect) {
      const shot = await captureRegionCli(session.dipRect)
      if (!shot) {
        console.warn('[clipthat] scroll: region shot failed')
        return
      }
      const last = session.frames[session.frames.length - 1]
      if (last !== shot.dataUrl) {
        session.frames.push(shot.dataUrl)
        broadcast('scroll:frame-count', session.frames.length)
      }
      return
    }

    const snap = await captureDisplay(session.displayId)
    if (!snap) {
      console.warn(`[clipthat] scroll: no frame from display ${session.displayId}`)
      return
    }
    const cropped = cropDataUrl(snap.dataUrl, session.rect)
    if (!cropped) {
      console.warn(
        `[clipthat] scroll: crop failed — rect ${JSON.stringify(session.rect)} in ${snap.pixelWidth}x${snap.pixelHeight}`
      )
      return
    }
    const last = session.frames[session.frames.length - 1]
    // Identical frames mean the user hasn't scrolled yet; don't grow the pile.
    if (last !== cropped.dataUrl) {
      session.frames.push(cropped.dataUrl)
      broadcast('scroll:frame-count', session.frames.length)
    }
  } catch (err) {
    console.warn(`[clipthat] scroll: frame grab threw — ${(err as Error).message}`)
  } finally {
    session.busy = false
  }
}

export function startScrollCapture(displayId: string, rect: Rect, dipRect?: Rect): void {
  stopScrollTimer()
  scrollSession = { displayId, rect, dipRect, frames: [], timer: null, busy: false }
  void grabScrollFrame()
  scrollSession.timer = setInterval(() => void grabScrollFrame(), 400)
}

function stopScrollTimer(): void {
  if (scrollSession?.timer) clearInterval(scrollSession.timer)
  if (scrollSession) scrollSession.timer = null
}

export async function finishScrollCapture(): Promise<CaptureResult | null> {
  const session = scrollSession
  stopScrollTimer()
  scrollSession = null
  if (!session || session.frames.length === 0) return null

  const stitched = stitchFrames(session.frames)
  if (!stitched) return null
  return makeResult(stitched.dataUrl, stitched.width, stitched.height, 'scrolling')
}

export function cancelScrollCapture(): void {
  stopScrollTimer()
  scrollSession = null
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * On macOS a capture with no Screen Recording permission doesn't error — it just
 * yields nothing. Say so out loud instead of appearing to do nothing at all.
 */
async function warnIfNoScreenAccess(): Promise<void> {
  if (process.platform !== 'darwin') return
  const { checkPermissions } = await import('../permissions')
  const report = await checkPermissions()
  if (report.screenVerified) return
  broadcast('system:toast', {
    kind: 'error',
    message: 'ClipThat cannot read the screen',
    detail: 'Grant Screen Recording in System Settings → Privacy & Security, then reopen ClipThat.'
  })
  showSettingsWindow('welcome')
}

export async function performCapture(req: CaptureRequest): Promise<CaptureResult | null> {
  if (req.delay && req.delay > 0) await sleep(req.delay * 1000)

  let result: CaptureResult | null = null

  switch (req.mode) {
    case 'region':
    case 'window': {
      const sel = await openOverlay(req.mode)
      if (!sel) return null
      result = await captureFromSelection(sel)
      break
    }
    case 'scrolling': {
      const sel = await openOverlay('scrolling')
      if (!sel) return null
      startScrollCapture(sel.displayId, sel.rect, sel.screenRect)
      // The floating controller drives the rest: the user scrolls, then hits Done,
      // which lands on `finishScrollCapture` via IPC.
      showHudWindow('scroll')
      return null
    }
    case 'lastRegion':
      result = await withAppWindowsHidden(captureLastRegion)
      if (!result) {
        const sel = await openOverlay('region')
        if (!sel) return null
        result = await captureFromSelection(sel)
      }
      break
    case 'display': {
      const id = req.displayId ?? String(displayUnderCursor().id)
      const snap = await withAppWindowsHidden(() => captureDisplay(id))
      if (snap) result = makeResult(snap.dataUrl, snap.pixelWidth, snap.pixelHeight, 'display')
      break
    }
    case 'fullscreen':
      result = await withAppWindowsHidden(captureWholeDesktop)
      break
  }

  if (!result) {
    await warnIfNoScreenAccess()
    return null
  }
  if (req.silent) {
    await routeResult(result, 'clipboard')
    return result
  }
  await routeResult(result)
  return result
}

/** Apply the user's "after capture" preference and always index into the library. */
export async function routeResult(
  result: CaptureResult,
  overrideAction?: 'editor' | 'clipboard' | 'file' | 'clipboardAndFile'
): Promise<void> {
  const s = settings.get()
  const action = overrideAction ?? s.afterCapture

  if (action === 'clipboard' || action === 'clipboardAndFile') {
    copyImageToClipboard(result.dataUrl)
  }

  if (action === 'file' || action === 'clipboardAndFile') {
    const saved = await saveImage({
      dataUrl: result.dataUrl,
      format: s.imageFormat,
      suggestedName: result.title
    })
    if (saved.ok && saved.filePath) {
      await library.addImage({
        dataUrl: result.dataUrl,
        title: result.title || formatFilename(s.filenameTemplate),
        width: result.width,
        height: result.height,
        existingPath: saved.filePath
      })
      broadcast('system:toast', {
        kind: 'success',
        message: 'Capture saved',
        detail: saved.filePath
      })
    }
    return
  }

  if (action === 'clipboard') {
    await library.addImage({
      dataUrl: result.dataUrl,
      title: result.title || formatFilename(s.filenameTemplate),
      width: result.width,
      height: result.height
    })
    broadcast('system:toast', { kind: 'success', message: 'Copied to clipboard' })
    return
  }

  openInEditor(documentFromCapture(result))
}

const pendingDocs = new Map<number, ClipDocument>()

/** Hand a document to a fresh editor window (or reuse an empty one). */
export function openInEditor(doc: ClipDocument): void {
  const win = createEditorWindow()
  pendingDocs.set(win.webContents.id, doc)
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('editor:document', doc)
  })
}

/** Renderers ask for their document on mount, which covers reloads in dev. */
export function takePendingDocument(webContentsId: number): ClipDocument | null {
  const doc = pendingDocs.get(webContentsId) ?? null
  return doc
}

export function releasePendingDocument(webContentsId: number): void {
  pendingDocs.delete(webContentsId)
}

export { closeOverlay, editorWindows, shell }
