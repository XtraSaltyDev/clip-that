import { nativeImage, screen, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  CaptureRequest,
  CaptureResult,
  ClipDocument,
  Rect,
  ScrollCaptureConfig,
  LibraryItem
} from '@shared/types'
import { formatFilename } from '@shared/defaults'
import { IPC } from '@shared/ipc'
import { settings } from '../store/settings'
import { library } from '../store/library'
import { copyImageToClipboard, loadProjectFile, saveImage } from '../export'
import {
  broadcast,
  createEditorWindow,
  editorWindowForReuse,
  editorWindows,
  showHudWindow,
  showSettingsWindow,
  withNonEditorAppWindowsHidden
} from '../windows/manager'
import { closeOverlay, openOverlay, takeFrozenSnapshot, type OverlaySelection } from '../windows/overlay'
import { showQuickAccess } from '../windows/quick'
import { runPipeline } from '../pipeline'
import { checkPermissions } from '../permissions'
import { captureDisplay, captureRegionCli, captureWindow, snapshotAllDisplays } from './backend'
import { displayPixelSize, displayUnderCursor, findDisplay } from './displays'
import { stitchPngFrames } from './stitch'
import { recording } from '../recording/session'

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

function captureTitle(result: CaptureResult, filenameTemplate: string): string {
  return result.title?.trim() || formatFilename(filenameTemplate, new Date(result.createdAt))
}

async function addCaptureToLibrary(
  result: CaptureResult,
  filenameTemplate: string
): Promise<LibraryItem> {
  return library.addImage({
    dataUrl: result.dataUrl,
    title: captureTitle(result, filenameTemplate),
    width: result.width,
    height: result.height
  })
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
  /** Compressed PNG bytes. Base64 strings cost roughly 33% more before JS string overhead. */
  frames: Buffer[]
  retainedBytes: number
  timer: NodeJS.Timeout | null
  inFlight: Promise<void> | null
  fallbackActive: boolean
  restoreEditorWindows?: () => void
}

function pngBytes(dataUrl: string): Buffer | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0 || !dataUrl.slice(0, comma).includes(';base64')) return null
  return Buffer.from(dataUrl.slice(comma + 1), 'base64')
}

function appendScrollFrame(session: ScrollSession, dataUrl: string): boolean {
  const png = pngBytes(dataUrl)
  return png ? appendScrollPng(session, png) : false
}

function appendScrollPng(session: ScrollSession, png: Buffer): boolean {
  if (session !== scrollSession || png.length < 8 || png.length > 64 * 1024 * 1024) return false
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false
  const last = session.frames[session.frames.length - 1]
  if (last?.equals(png)) return false
  // Bound a forgotten capture session instead of allowing it to consume the machine.
  if (session.frames.length >= 300) return false
  if (session.retainedBytes + png.length > 512 * 1024 * 1024) return false
  session.frames.push(png)
  session.retainedBytes += png.length
  broadcast(IPC.captureScrollFrameCount, session.frames.length)
  return true
}

let scrollSession: ScrollSession | null = null

export function scrollCaptureActive(): boolean {
  return scrollSession !== null
}

async function grabScrollFrame(session: ScrollSession): Promise<void> {
  try {
    if (process.platform === 'darwin' && session.dipRect) {
      const shot = await captureRegionCli(session.dipRect)
      if (!shot) {
        console.warn('[clipthat] scroll: region shot failed')
        return
      }
      appendScrollFrame(session, shot.dataUrl)
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
    // Identical frames mean the user hasn't scrolled yet; don't grow the pile.
    appendScrollFrame(session, cropped.dataUrl)
  } catch (err) {
    console.warn(`[clipthat] scroll: frame grab threw — ${(err as Error).message}`)
  }
}

function scheduleFallbackFrame(session: ScrollSession): Promise<void> {
  if (session !== scrollSession) return Promise.resolve()
  if (session.inFlight) return session.inFlight
  const pending = grabScrollFrame(session).finally(() => {
    if (session === scrollSession) session.inFlight = null
  })
  session.inFlight = pending
  return pending
}

function queueFallbackFrame(session: ScrollSession, delayMs: number): void {
  if (session !== scrollSession || !session.fallbackActive) return
  session.timer = setTimeout(() => {
    session.timer = null
    void scheduleFallbackFrame(session).finally(() => {
      if (session === scrollSession && session.fallbackActive) queueFallbackFrame(session, 400)
    })
  }, delayMs)
}

export function startScrollCapture(
  displayId: string,
  rect: Rect,
  dipRect?: Rect,
  restoreEditorWindows?: () => void
): void {
  cancelScrollCapture()
  scrollSession = {
    displayId,
    rect,
    dipRect,
    frames: [],
    retainedBytes: 0,
    timer: null,
    inFlight: null,
    fallbackActive: false,
    restoreEditorWindows
  }
  recording.setDisplayOverride(displayId)
}

export function scrollCaptureConfig(): ScrollCaptureConfig | null {
  const session = scrollSession
  const display = session ? findDisplay(session.displayId) : undefined
  if (!session || !display) return null
  const pixels = displayPixelSize(display)
  return { rect: { ...session.rect }, displayWidth: pixels.width, displayHeight: pixels.height, intervalMs: 400 }
}

/** Accept a cropped PNG from the isolated HUD renderer. */
export function appendScrollFrameBytes(bytes: Uint8Array): boolean {
  const session = scrollSession
  if (!session || !(bytes instanceof Uint8Array)) return false
  return appendScrollPng(session, Buffer.from(bytes))
}

/** Reliable but slow path for systems where a live ScreenCaptureKit stream cannot start. */
export function startScrollFallback(reason = 'live stream unavailable'): void {
  const session = scrollSession
  if (!session || session.fallbackActive) return
  session.fallbackActive = true
  console.warn(`[clipthat] scroll: using still-frame fallback — ${reason}`)
  // Let the failed stream release ScreenCaptureKit before asking the CLI for the same
  // display. Recursive timeouts also prevent fast failures from becoming a retry storm.
  queueFallbackFrame(session, 1200)
}

function stopScrollTimer(): void {
  if (scrollSession?.timer) clearInterval(scrollSession.timer)
  if (scrollSession) scrollSession.timer = null
}

export async function finishScrollCapture(): Promise<CaptureResult | null> {
  const session = scrollSession
  stopScrollTimer()
  if (session?.inFlight) await session.inFlight
  scrollSession = null
  recording.setDisplayOverride(null)
  try {
    if (!session || session.frames.length === 0) return null

    const stitched = stitchPngFrames(session.frames)
    if (!stitched) return null
    return makeResult(stitched.dataUrl, stitched.width, stitched.height, 'scrolling')
  } finally {
    session?.restoreEditorWindows?.()
  }
}

export function cancelScrollCapture(): void {
  const session = scrollSession
  stopScrollTimer()
  scrollSession = null
  recording.setDisplayOverride(null)
  session?.restoreEditorWindows?.()
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
      startScrollCapture(sel.displayId, sel.rect, sel.screenRect, sel.restoreEditorWindows)
      // Start source discovery only after the user chooses scrolling capture. Doing this
      // at app launch contends with still screenshots on multi-display Macs.
      void recording.prewarmDisplaySources()
      // The floating controller drives the rest: the user scrolls, then hits Done,
      // which lands on `finishScrollCapture` via IPC.
      showHudWindow('scroll')
      return null
    }
    case 'lastRegion':
      result = await withNonEditorAppWindowsHidden(captureLastRegion)
      if (!result) {
        const sel = await openOverlay('region')
        if (!sel) return null
        result = await captureFromSelection(sel)
      }
      break
    case 'display': {
      const id = req.displayId ?? String(displayUnderCursor().id)
      const snap = await withNonEditorAppWindowsHidden(() => captureDisplay(id))
      if (snap) result = makeResult(snap.dataUrl, snap.pixelWidth, snap.pixelHeight, 'display')
      break
    }
    case 'fullscreen':
      result = await withNonEditorAppWindowsHidden(captureWholeDesktop)
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

/** Open a capture in the editor, linked to an existing Library item when there is one. */
export function openResultInEditor(result: CaptureResult, libraryId?: string): void {
  const doc = documentFromCapture(result)
  // The editor keys its save-back-to-Library behaviour off the document id.
  if (libraryId) doc.id = libraryId
  if (!openInExistingEditor(doc)) openInEditor(doc)
}

/** Apply the user's "after capture" preference and always index into the library. */
export async function routeResult(
  result: CaptureResult,
  overrideAction?: import('@shared/types').AfterCapture
): Promise<void> {
  const s = settings.get()
  const action = overrideAction ?? s.afterCapture

  if (action === 'pipeline') {
    await runPipeline(result, s.pipeline, openResultInEditor)
    return
  }

  if (action === 'quickAccess') {
    // Library first so nothing is lost even if the card is dismissed unread.
    const item = await addCaptureToLibrary(result, s.filenameTemplate)
    showQuickAccess(result, item.id)
    return
  }

  if (action === 'editor') {
    const item = await addCaptureToLibrary(result, s.filenameTemplate)
    openResultInEditor(result, item.id)
    return
  }

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
        height: result.height
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
    await addCaptureToLibrary(result, s.filenameTemplate)
    broadcast('system:toast', { kind: 'success', message: 'Copied to clipboard' })
    return
  }

  openInEditor(documentFromCapture(result))
}

const pendingDocs = new Map<number, ClipDocument>()
const pendingVideos = new Map<number, LibraryItem>()

function deliverDocument(win: Electron.BrowserWindow, doc: ClipDocument): void {
  pendingVideos.delete(win.webContents.id)
  pendingDocs.set(win.webContents.id, doc)
  const send = () => {
    if (win.isDestroyed()) return
    win.webContents.send('editor:document', doc)
    win.show()
    win.focus()
  }
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', send)
    return
  }
  send()
}

function deliverVideo(win: Electron.BrowserWindow, item: LibraryItem): void {
  pendingDocs.delete(win.webContents.id)
  pendingVideos.set(win.webContents.id, item)
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.editorVideo, item)
  }
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', send)
  else send()
  win.show()
  win.focus()
}

/** Hand a document to a fresh editor window. */
export function openInEditor(doc: ClipDocument, hash = ''): void {
  const win = createEditorWindow(hash)
  deliverDocument(win, doc)
}

/** Open a Library recording in ClipThat's own playback and trim workspace. */
export function openVideoInEditor(item: LibraryItem): void {
  const win = createEditorWindow()
  deliverVideo(win, item)
}

/** Replace a reusable editor's document and bring that editor forward. */
export function openInExistingEditor(doc: ClipDocument): boolean {
  const win = editorWindowForReuse()
  if (!win) return false
  deliverDocument(win, doc)
  return true
}

/** Load an editable image document from the Library, including flattened-only captures. */
export async function loadLibraryDocument(id: string): Promise<ClipDocument | null> {
  const item = library.get(id)
  if (!item || item.kind !== 'image') return null
  const loaded = (await library.loadProject(id)) ?? (await loadProjectFile(item.filePath))
  return loaded
    ? { ...loaded, id: item.id, title: item.title, exportPath: item.exportPath }
    : null
}

/** Switch only the editor that sent the request; other open editors are left untouched. */
export async function switchEditorToLibraryItem(
  webContentsId: number,
  libraryId: string
): Promise<boolean> {
  const win = editorWindows().find((candidate) => candidate.webContents.id === webContentsId)
  if (!win) return false
  const item = library.get(libraryId)
  if (item?.kind === 'video') {
    deliverVideo(win, item)
    return true
  }
  const doc = await loadLibraryDocument(libraryId)
  if (!doc) return false
  deliverDocument(win, doc)
  return true
}

/** Renderers ask for their document on mount, which covers reloads in dev. */
export function takePendingDocument(webContentsId: number): ClipDocument | null {
  const doc = pendingDocs.get(webContentsId) ?? null
  return doc
}

export function takePendingVideo(webContentsId: number): LibraryItem | null {
  return pendingVideos.get(webContentsId) ?? null
}

export function releasePendingDocument(webContentsId: number): void {
  pendingDocs.delete(webContentsId)
  pendingVideos.delete(webContentsId)
}

export { closeOverlay, editorWindows, shell }
