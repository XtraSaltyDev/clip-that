import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { loadEntry, preloadPath, type RendererEntry } from './urls'
import { registerRendererWindow } from '../ipc/sender'

const IS_MAC = process.platform === 'darwin'

const icon = () => join(__dirname, '../../build/icon.png')

function baseOptions(): Electron.BrowserWindowConstructorOptions {
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
      spellcheck: false
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
const editorCloseState = new Map<
  number,
  { win: BrowserWindow; ready: boolean; pending: boolean; approved: boolean }
>()
let editorAppQuitRequested = false

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

export function createEditorWindow(): BrowserWindow {
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
  const closeState = { win, ready: false, pending: false, approved: false }
  editorCloseState.set(win.webContents.id, closeState)
  win.on('close', (event) => {
    if (closeState.approved || !closeState.ready || win.webContents.isDestroyed()) return
    event.preventDefault()
    if (closeState.pending) return
    closeState.pending = true
    win.webContents.send(IPC.editorCloseRequested)
  })
  win.on('closed', () => {
    editors.delete(win)
    editorCloseState.delete(win.webContents.id)
  })
  win.webContents.on('render-process-gone', () => {
    closeState.approved = true
  })
  loadEntry(win, 'editor')
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  return win
}

export function showLibraryWindow(): BrowserWindow {
  const existing = getSingleton('library')
  if (existing) {
    existing.show()
    existing.focus()
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
  win.once('ready-to-show', () => win.show())
  return win
}

export function showSettingsWindow(section = 'general'): BrowserWindow {
  const existing = getSingleton('settings')
  if (existing) {
    existing.show()
    existing.focus()
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
  win.once('ready-to-show', () => win.show())
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
    ...baseOptions(),
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
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
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
    hudDisplayId === null ? undefined : screen.getAllDisplays().find((item) => item.id === hudDisplayId)
  const display = remembered ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  win.setBounds({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height)
  }, false)
}

export function closeHudWindow(): void {
  getSingleton('hud')?.close()
}

let worker: BrowserWindow | null = null

/**
 * Hidden worker window. OCR needs WASM and a DOM canvas, neither of which exists in
 * the main process, so it runs here — invisible, and shared by every caller.
 */
export function getWorkerWindow(): Promise<BrowserWindow> {
  if (worker && !worker.isDestroyed()) {
    return worker.webContents.isLoading()
      ? new Promise((r) => worker!.webContents.once('did-finish-load', () => r(worker!)))
      : Promise.resolve(worker)
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
  loadEntry(win, 'hud', 'worker')
  return new Promise((resolve) => {
    win.webContents.once('did-finish-load', () => resolve(win))
  })
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
