import { BrowserWindow, screen } from 'electron'
import type { DisplaySnapshot, Rect } from '@shared/types'
import { loadEntry, preloadPath } from './urls'
import { snapshotAllDisplays } from '../capture/backend'
import { withAppWindowsHidden } from './manager'

const IS_MAC = process.platform === 'darwin'

export type OverlayMode = 'region' | 'window' | 'display' | 'scrolling'

export interface OverlaySelection {
  displayId: string
  /** Selection in *image pixel* coordinates of that display's snapshot. */
  rect: Rect
  /** Same selection expressed in virtual-desktop DIPs, for "repeat last region". */
  screenRect: Rect
  mode: OverlayMode
  /** Set when the user picked a window from the picker instead of dragging. */
  windowId?: string
}

interface Pending {
  resolve: (value: OverlaySelection | null) => void
  windows: BrowserWindow[]
  snapshots: DisplaySnapshot[]
}

let pending: Pending | null = null

/** Snapshots from the overlay that just closed, held for the crop that follows. */
let closedSnapshots: DisplaySnapshot[] = []

export function isOverlayOpen(): boolean {
  return pending !== null
}

/**
 * Pre-warmed overlay windows, one per display.
 *
 * Creating and loading a BrowserWindow is the slowest part of starting a capture
 * (~300–500ms). Keeping loaded windows hidden in a pool turns "hotkey → crosshair"
 * into: snapshot, position, show.
 */
const pool: BrowserWindow[] = []
const poolReady = new WeakMap<BrowserWindow, Promise<void>>()

function makeOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    x: 0,
    y: 0,
    width: 480,
    height: 320,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    // A panel floats above full-screen spaces on macOS; other platforms ignore it.
    type: IS_MAC ? 'panel' : undefined,
    title: 'ClipThat Capture',
    webPreferences: {
      preload: preloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  loadEntry(win, 'overlay')
  poolReady.set(
    win,
    new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
  )
  win.on('closed', () => {
    const i = pool.indexOf(win)
    if (i >= 0) pool.splice(i, 1)
  })
  return win
}

/** Called at startup and after display changes; safe to call repeatedly. */
export function ensureOverlayPool(): void {
  const want = screen.getAllDisplays().length
  while (pool.length < want) pool.push(makeOverlayWindow())
}

/** True while any pooled overlay is on screen (the crosshair is up). */
export function overlayVisible(): boolean {
  return pool.some((w) => !w.isDestroyed() && w.isVisible())
}

export function installOverlayPool(): void {
  ensureOverlayPool()
  const rebuild = () => {
    // Display geometry changed; loaded pages are fine, counts may not be.
    ensureOverlayPool()
  }
  screen.on('display-added', rebuild)
  screen.on('display-removed', rebuild)
}

export async function openOverlay(mode: OverlayMode): Promise<OverlaySelection | null> {
  if (pending) closeOverlay(null)

  const t0 = Date.now()
  const snapshots = await withAppWindowsHidden(snapshotAllDisplays)
  const tSnap = Date.now()
  if (snapshots.length === 0) {
    // performCapture handles the missing-permission case; this is the transient one.
    const { broadcast } = await import('./manager')
    broadcast('system:toast', {
      kind: 'error',
      message: 'The screen could not be read just now',
      detail: 'Usually a moment of capture-service congestion — try again.'
    })
    return null
  }

  console.log(
    `[clipthat] overlay: ${screen.getAllDisplays().length} display(s), ` +
      `${snapshots.length} snapshot(s) — ` +
      snapshots
        .map(
          (s) =>
            `${s.displayId} @${s.bounds.x},${s.bounds.y} ${s.bounds.width}x${s.bounds.height} ` +
            `→ ${s.pixelWidth}x${s.pixelHeight}`
        )
        .join(' | ')
  )

  ensureOverlayPool()
  const windows: BrowserWindow[] = []
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  // Snapshot is already taken; showing the overlays cannot affect it.


  await Promise.all(
    snapshots.map(async (snap, i) => {
      const display = screen.getAllDisplays().find((d) => String(d.id) === snap.displayId)
      const win = pool[i]
      if (!display || !win || win.isDestroyed()) return

      await poolReady.get(win)
      win.setBounds(display.bounds)
      win.webContents.send('overlay:init', { mode, snapshot: snap, displayCount: snapshots.length })
      win.setBounds(display.bounds)
      if (cursorDisplay.id === display.id) win.show()
      else win.showInactive()
      windows.push(win)
    })
  )

  if (windows.length === 0) return null
  console.log(
    `[clipthat] capture latency: snapshot=${tSnap - t0}ms show=${Date.now() - tSnap}ms total=${Date.now() - t0}ms`
  )

  return new Promise<OverlaySelection | null>((resolve) => {
    pending = { resolve, windows, snapshots }
  })
}

/** Called by the IPC layer when a renderer finishes or aborts a selection. */
export function closeOverlay(selection: OverlaySelection | null): void {
  const current = pending
  pending = null
  if (!current) return
  // The selection is in the coordinate space of these exact images; whoever crops
  // next must use them, not a fresh photograph of a screen that has since changed.
  closedSnapshots = selection ? current.snapshots : []

  for (const win of [...current.windows]) {
    if (!win.isDestroyed()) win.hide()
  }
  current.resolve(selection)
}

export function overlaySnapshots(): DisplaySnapshot[] {
  return pending?.snapshots ?? []
}

/**
 * Take the frozen snapshot for a display from the overlay that just closed.
 * Consuming (rather than peeking) keeps a later capture from cropping stale pixels.
 */
export function takeFrozenSnapshot(displayId: string): DisplaySnapshot | undefined {
  const snap = closedSnapshots.find((s) => s.displayId === displayId)
  closedSnapshots = []
  return snap
}

/** Broadcast to sibling overlays, e.g. to clear hints on the display not being used. */
export function notifyOverlays(channel: string, payload: unknown, except?: number): void {
  if (!pending) return
  for (const win of pending.windows) {
    if (!win.isDestroyed() && win.webContents.id !== except) {
      win.webContents.send(channel, payload)
    }
  }
}
