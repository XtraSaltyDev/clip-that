import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { loadEntry, preloadPath, type RendererEntry } from './urls'
import { registerRendererWindow } from '../ipc/sender'

const IS_MAC = process.platform === 'darwin'

const icon = () => join(__dirname, '../../build/icon.png')

/** Restore ordinary app-window semantics after transient capture chrome used other Spaces. */
function showPrimaryWindow(win: BrowserWindow): void {
  win.setAlwaysOnTop(false)
  if (IS_MAC) win.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true })
  win.show()
  win.focus()
}

function baseOptions(backgroundThrottling = true): Electron.BrowserWindowConstructorOptions {
  return {
    show: false,
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    icon: process.platform === 'linux' ? icon() : undefined,
    webPreferences: {
      preload: preloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling
    }
  }
}

/** Windows that exist at most once. */
const singletons = new Map<RendererEntry, BrowserWindow>()
let hudDisplayId: number | null = null

export function getSingleton(entry: RendererEntry): BrowserWindow | undefined {
  const win = singletons.get(entry)
  return win && !win.isDestroyed() ? win : undefined
}

const editors = new Set<BrowserWindow>()
const editorLastFocused = new Map<BrowserWindow, number>()
let editorFocusSequence = 0
const editorCloseState = new Map<
  number,
  { win: BrowserWindow; ready: boolean; pending: boolean; approved: boolean }
>()
let editorAppQuitRequested = false

function rememberEditorFocus(win: BrowserWindow): void {
  editorLastFocused.set(win, ++editorFocusSequence)
}

export function markEditorAppQuitRequested(): void {
  editorAppQuitRequested = true
}

export function markEditorCloseReady(webContentsId: number): boolean {
  const state = editorCloseState.get(webContentsId)
  if (!state) return false
  state.ready = true
  return true
}

export function resolveEditorClose(webContentsId: number, allow: boolean): boolean {
  const state = editorCloseState.get(webContentsId)
  if (!state || state.win.isDestroyed()) return false
  state.pending = false
  if (!allow) return true
  state.approved = true
  state.win.close()
  if (editorAppQuitRequested) setTimeout(() => app.quit(), 0)
  return true
}

export function createEditorWindow(hash = ''): BrowserWindow {
  const win = new BrowserWindow({
    ...baseOptions(),
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'ClipThat',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    trafficLightPosition: IS_MAC ? { x: 16, y: 18 } : undefined
  })
  registerRendererWindow(win, 'editor')
  editors.add(win)
  rememberEditorFocus(win)
  win.on('focus', () => rememberEditorFocus(win))
  const webContentsId = win.webContents.id
  const closeState = { win, ready: false, pending: false, approved: false }
  editorCloseState.set(webContentsId, closeState)
  win.on('close', (event) => {
    if (closeState.approved || !closeState.ready || win.webContents.isDestroyed()) return
    event.preventDefault()
    if (closeState.pending) return
    closeState.pending = true
    win.webContents.send(IPC.editorCloseRequested)
  })
  win.on('closed', () => {
    editors.delete(win)
    editorLastFocused.delete(win)
    editorCloseState.delete(webContentsId)
  })
  win.webContents.on('render-process-gone', () => {
    closeState.approved = true
  })
  loadEntry(win, 'editor', hash)
  win.once('ready-to-show', () => {
    showPrimaryWindow(win)
  })
  return win
}

export function showLibraryWindow(): BrowserWindow {
  const existing = getSingleton('library')
  if (existing) {
    showPrimaryWindow(existing)
    return existing
  }
  const win = new BrowserWindow({
    ...baseOptions(),
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    title: 'ClipThat Library',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    trafficLightPosition: IS_MAC ? { x: 16, y: 18 } : undefined
  })
  registerRendererWindow(win, 'library')
  singletons.set('library', win)
  win.on('closed', () => singletons.delete('library'))
  loadEntry(win, 'library')
  win.once('ready-to-show', () => showPrimaryWindow(win))
  return win
}

export function showSettingsWindow(section = 'general'): BrowserWindow {
  const existing = getSingleton('settings')
  if (existing) {
    showPrimaryWindow(existing)
    existing.webContents.send(IPC.settingsNavigate, section)
    return existing
  }
  const win = new BrowserWindow({
    ...baseOptions(),
    width: 860,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    resizable: true,
    title: 'ClipThat Settings',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    trafficLightPosition: IS_MAC ? { x: 16, y: 18 } : undefined
  })
  registerRendererWindow(win, 'settings')
  singletons.set('settings', win)
  win.on('closed', () => singletons.delete('settings'))
  loadEntry(win, 'settings', section)
  win.once('ready-to-show', () => showPrimaryWindow(win))
  return win
}

/**
 * Small always-on-top controller. Serves both the recorder and the scrolling-capture
 * session; `hash` picks which one the renderer mounts.
 */
export function showHudWindow(hash = ''): BrowserWindow {
  const existing = getSingleton('hud')
  if (existing) {
    existing.show()
    return existing
  }
  const win = new BrowserWindow({
    // The hidden video/canvas recording compositor lives in this renderer. Letting the
    // HUD throttle in the background can stall captured frames when focus or Spaces move.
    ...baseOptions(false),
    width: 440,
    height: 600,
    resizable: false,
    movable: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    center: hash !== 'scroll',
    title: 'ClipThat Recorder'
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  })
  registerRendererWindow(win, 'hud')
  singletons.set('hud', win)
  hudDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
  win.on('closed', () => {
    singletons.delete('hud')
    hudDisplayId = null
  })
  loadEntry(win, 'hud', hash)
  win.once('ready-to-show', () => {
    if (hash === 'scroll') {
      // The scroll controller must not steal focus — the user is about to scroll
      // the window underneath it.
      dockHud(360, 76)
      win.showInactive()
    } else {
      centerHud(win, 440, 600)
      win.show()
      win.focus()
    }
  })
  return win
}

/** Park the recorder controller at the bottom-centre of the active display. */
export function dockHud(width: number, height: number): void {
  const win = getSingleton('hud')
  if (!win) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  win.setBounds({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height - height - 32),
    width: Math.round(width),
    height: Math.round(height)
  })
}

function centerHud(win: BrowserWindow, width: number, height: number): void {
  const remembered =
    hudDisplayId === null
      ? undefined
      : screen.getAllDisplays().find((item) => item.id === hudDisplayId)
  const display = remembered ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  win.setBounds(
    {
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width: Math.round(width),
      height: Math.round(height)
    },
    false
  )
}

export function closeHudWindow(): void {
  getSingleton('hud')?.close()
}

let worker: BrowserWindow | null = null

function waitForWorkerReady(win: BrowserWindow, waitForNavigation = false): Promise<BrowserWindow> {
  if (!waitForNavigation && !win.webContents.isLoading()) return Promise.resolve(win)

  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      win.webContents.removeListener('did-finish-load', onReady)
      win.webContents.removeListener('did-fail-load', onFailed)
      win.webContents.removeListener('render-process-gone', onGone)
      win.removeListener('closed', onClosed)
    }
    const succeed = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(win)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (worker === win) worker = null
      if (!win.isDestroyed()) win.destroy()
      reject(error)
    }
    const onReady = () => succeed()
    const onFailed = (_event: Electron.Event, code: number, description: string) =>
      fail(new Error(`OCR worker failed to load (${code}): ${description}`))
    const onGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) =>
      fail(new Error(`OCR worker renderer exited: ${details.reason}`))
    const onClosed = () => fail(new Error('OCR worker window closed before it was ready'))

    win.webContents.once('did-finish-load', onReady)
    win.webContents.once('did-fail-load', onFailed)
    win.webContents.once('render-process-gone', onGone)
    win.once('closed', onClosed)
  })
}

/**
 * Hidden worker window. OCR needs WASM and a DOM canvas, neither of which exists in
 * the main process, so it runs here — invisible, and shared by every caller.
 */
export function getWorkerWindow(): Promise<BrowserWindow> {
  if (worker && !worker.isDestroyed()) {
    return waitForWorkerReady(worker)
  }

  const win = new BrowserWindow({
    ...baseOptions(),
    width: 400,
    height: 300,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      ...baseOptions().webPreferences,
      backgroundThrottling: false,
      offscreen: false
    }
  })
  registerRendererWindow(win, 'worker')
  worker = win
  win.on('closed', () => {
    if (worker === win) worker = null
  })
  const ready = waitForWorkerReady(win, true)
  loadEntry(win, 'hud', 'worker')
  return ready
}

/** Release Tesseract's hidden Chromium/WASM process after an idle spell. */
export function closeWorkerWindow(): void {
  const current = worker
  worker = null
  if (current && !current.isDestroyed()) current.close()
}

/** Resize a frameless window from its own renderer (used by the recorder HUD). */
export function resizeWindow(win: BrowserWindow | null, width: number, height: number): void {
  if (!win || win.isDestroyed()) return
  if (win === getSingleton('hud')) {
    // Recorder completion changes the HUD's height substantially. Retaining the old
    // top-left corner can leave the result panel below a short display (or an offset
    // secondary display), so keep it centred on the display where recording began.
    centerHud(win, width, height)
    return
  }
  const [x, y] = win.getPosition()
  win.setBounds({ x, y, width: Math.round(width), height: Math.round(height) }, false)
}

export interface HideAppWindowsOptions {
  /** Visible app windows that should remain in the captured scene. */
  exclude?: readonly BrowserWindow[]
}

export type RestoreAppWindows = (keepHidden?: readonly BrowserWindow[]) => void

/**
 * Hide visible ClipThat windows while a screen snapshot is taken, then put them back.
 *
 * Editors may be excluded so they remain ordinary capture subjects. The returned
 * restore function can also leave selected windows hidden, which lets the capture
 * overlay take an alternate editor-free snapshot without flashing the editor back.
 */
export async function hideAppWindows(
  options: HideAppWindowsOptions = {}
): Promise<RestoreAppWindows> {
  const excluded = new Set(options.exclude ?? [])
  const ours = BrowserWindow.getAllWindows().filter(
    (w) => !w.isDestroyed() && w.isVisible() && w !== worker && !excluded.has(w)
  )
  if (ours.length === 0) return () => {}

  for (const w of ours) w.hide()
  // One breath for the compositor to actually drop them from the frame. Too short and
  // the capture can still contain a half-torn-down window surface.
  await new Promise((r) => setTimeout(r, 180))
  let restored = false
  return (keepHidden = []) => {
    if (restored) return
    restored = true
    const retained = new Set(keepHidden)
    // Restore without stealing focus; during region capture these reappear underneath
    // the overlay, which floats at screen-saver level.
    for (const w of ours) {
      if (!w.isDestroyed() && !retained.has(w)) w.showInactive()
    }
  }
}

export async function withAppWindowsHidden<T>(
  fn: () => Promise<T>,
  options: HideAppWindowsOptions = {}
): Promise<T> {
  const restore = await hideAppWindows(options)
  try {
    return await fn()
  } finally {
    restore()
  }
}

/** Keep visible editors in direct display/fullscreen captures while hiding app chrome. */
export function withNonEditorAppWindowsHidden<T>(fn: () => Promise<T>): Promise<T> {
  return withAppWindowsHidden(fn, { exclude: editorWindows() })
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

export function editorWindows(): BrowserWindow[] {
  return [...editors].filter((w) => !w.isDestroyed())
}

/** Choose the focused editor, or the most recently focused editor when the app is inactive. */
export function editorWindowForReuse(): BrowserWindow | undefined {
  const windows = editorWindows()
  const focused = windows.find((win) => win.isFocused())
  if (focused) return focused

  let mostRecent: BrowserWindow | undefined
  let mostRecentSequence = -1
  for (const win of windows) {
    const sequence = editorLastFocused.get(win) ?? 0
    if (sequence > mostRecentSequence) {
      mostRecent = win
      mostRecentSequence = sequence
    }
  }
  return mostRecent
}

/**
 * True when a window the user can actually see is still open.
 *
 * The OCR worker is a permanently hidden window and the recorder HUD is a floating
 * control, so neither should keep the app alive on its own.
 */
export function hasVisibleWindows(): boolean {
  const hud = getSingleton('hud')
  return BrowserWindow.getAllWindows().some(
    (w) => !w.isDestroyed() && w.isVisible() && w !== hud && w !== worker
  )
}
