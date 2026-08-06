import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { loadEntry, preloadPath, type RendererEntry } from './urls'

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
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  }
}

/** Windows that exist at most once. */
const singletons = new Map<RendererEntry, BrowserWindow>()

export function getSingleton(entry: RendererEntry): BrowserWindow | undefined {
  const win = singletons.get(entry)
  return win && !win.isDestroyed() ? win : undefined
}

function harden(win: BrowserWindow): void {
  // Nothing in this app should ever spawn a browser window or navigate away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (dev && url.startsWith(dev)) return
    event.preventDefault()
  })
}

const editors = new Set<BrowserWindow>()

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
  harden(win)
  editors.add(win)
  win.on('closed', () => editors.delete(win))
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
  harden(win)
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
    existing.webContents.send('settings:navigate', section)
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
  harden(win)
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
  harden(win)
  singletons.set('hud', win)
  win.on('closed', () => singletons.delete('hud'))
  loadEntry(win, 'hud', hash)
  win.once('ready-to-show', () => {
    if (hash === 'scroll') {
      // The scroll controller must not steal focus — the user is about to scroll
      // the window underneath it.
      dockHud(360, 76)
      win.showInactive()
    } else {
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
  worker = win
  win.on('closed', () => {
    worker = null
  })
  loadEntry(win, 'hud', 'worker')
  return new Promise((resolve) => {
    win.webContents.once('did-finish-load', () => resolve(win))
  })
}

/** Resize a frameless window from its own renderer (used by the recorder HUD). */
export function resizeWindow(win: BrowserWindow | null, width: number, height: number): void {
  if (!win || win.isDestroyed()) return
  const [x, y] = win.getPosition()
  win.setBounds({ x, y, width: Math.round(width), height: Math.round(height) }, false)
}

/**
 * Hide every visible ClipThat window while `fn` runs, then put them back.
 *
 * A screenshot tool must not appear in its own screenshots — and worse, the act of
 * triggering a capture (clicking a button, closing the tray menu) reorders windows in
 * the instant before the snapshot, so what gets frozen is not what the user remembers
 * seeing. Removing our windows from the scene sidesteps both problems.
 */
export async function withAppWindowsHidden<T>(fn: () => Promise<T>): Promise<T> {
  const ours = BrowserWindow.getAllWindows().filter(
    (w) => !w.isDestroyed() && w.isVisible() && w !== worker
  )
  if (ours.length === 0) return fn()

  for (const w of ours) w.hide()
  // One breath for the compositor to actually drop them from the frame. Too short and
  // the capture can still contain a half-torn-down window surface.
  await new Promise((r) => setTimeout(r, 180))
  try {
    return await fn()
  } finally {
    // Restore without stealing focus; during region capture these reappear underneath
    // the overlay, which floats at screen-saver level.
    for (const w of ours) {
      if (!w.isDestroyed()) w.showInactive()
    }
  }
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

