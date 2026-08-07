import { BrowserWindow, nativeImage, screen } from 'electron'
import { IPC } from '@shared/ipc'
import type { DisplaySnapshot, Rect } from '@shared/types'
import { loadEntry, preloadPath } from './urls'
import { beginOverlaySnapshots } from '../capture/backend'
import { hideAppWindows } from './manager'

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
let openingGeneration = 0

/** Snapshots from the overlay that just closed, held for the crop that follows. */
let closedSnapshots: DisplaySnapshot[] = []

function windowPickerBackdrop(display: Electron.Display): DisplaySnapshot {
  // Window mode never crops the display snapshot; it only needs a neutral backdrop behind
  // the preview grid. Avoiding a full desktop capture also prevents back-to-back screen and
  // window enumeration requests from congesting macOS's capture service.
  const pixel = nativeImage.createFromBitmap(Buffer.from([5, 7, 11, 255]), {
    width: 1,
    height: 1
  })
  return {
    displayId: String(display.id),
    dataUrl: pixel.toDataURL(),
    bounds: { ...display.bounds },
    scaleFactor: 1,
    pixelWidth: 1,
    pixelHeight: 1
  }
}

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
let poolRetireTimer: NodeJS.Timeout | null = null

function cancelPoolRetirement(): void {
  if (poolRetireTimer) clearTimeout(poolRetireTimer)
  poolRetireTimer = null
}

function retireOverlayPoolAfterIdle(): void {
  cancelPoolRetirement()
  poolRetireTimer = setTimeout(() => {
    poolRetireTimer = null
    // Destroying the hidden compositor surfaces is the only reliable way to make
    // Chromium return their GPU allocations. A future capture recreates these windows
    // while the OS snapshot is being taken, so their load time is normally hidden.
    for (const win of [...pool]) if (!win.isDestroyed()) win.destroy()
  }, 10_000)
}

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
  const generation = ++openingGeneration
  cancelPoolRetirement()
  // A new capture can never consume an older capture's frozen pixels.
  closedSnapshots = []

  // Start renderer creation before screen capture so a retired pool reloads in parallel
  // with the slower OS snapshot path.
  ensureOverlayPool()

  const t0 = Date.now()
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  // Keep our ordinary windows hidden until the final display is frozen. The cursor
  // display can be interactive during that work, but a later display must not capture
  // the editor or library when it is added to the overlay.
  const restoreAppWindows = mode === 'window' ? () => {} : await hideAppWindows()
  const captured =
    mode === 'window'
      ? { initial: windowPickerBackdrop(cursorDisplay), remaining: Promise.resolve([] as DisplaySnapshot[]) }
      : await beginOverlaySnapshots(String(cursorDisplay.id))
  if (generation !== openingGeneration) {
    restoreAppWindows()
    return null
  }
  // The window picker is a single control surface. Showing a duplicate picker on every
  // monitor also decoded every preview and backdrop once per display. Put it where the
  // pointer is; the list still contains windows from the whole desktop.
  const snapshots = captured.initial ? [captured.initial] : []
  const tSnap = Date.now()
  if (snapshots.length === 0) {
    // performCapture handles the missing-permission case; this is the transient one.
    const { broadcast } = await import('./manager')
    broadcast('system:toast', {
      kind: 'error',
      message: 'The screen could not be read just now',
      detail: 'Usually a moment of capture-service congestion — try again.'
    })
    restoreAppWindows()
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

  const windows: BrowserWindow[] = []
  const showSnapshot = async (snap: DisplaySnapshot): Promise<void> => {
    const display = screen.getAllDisplays().find((d) => String(d.id) === snap.displayId)
    const win = pool.find((candidate) => !candidate.isDestroyed() && !windows.includes(candidate))
    if (!display || !win || win.isDestroyed()) return

    await poolReady.get(win)
    if (generation !== openingGeneration) return
    win.setBounds(display.bounds)
    win.webContents.send('overlay:init', { mode, snapshot: snap, displayCount: screen.getAllDisplays().length })
    if (cursorDisplay.id === display.id) win.show()
    else win.showInactive()
    windows.push(win)
  }
  // Snapshot is already taken; showing the overlays cannot affect it.
  await Promise.all(snapshots.map(showSnapshot))

  if (generation !== openingGeneration) {
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.captureOverlayRelease)
        win.hide()
      }
    }
    retireOverlayPoolAfterIdle()
    restoreAppWindows()
    return null
  }

  if (windows.length === 0) {
    restoreAppWindows()
    return null
  }
  console.log(
    `[clipthat] capture latency: snapshot=${tSnap - t0}ms show=${Date.now() - tSnap}ms total=${Date.now() - t0}ms`
  )

  const selection = new Promise<OverlaySelection | null>((resolve) => {
    pending = { resolve, windows, snapshots }
  })
  // The other displays are still captured one at a time. They join the active overlay
  // as soon as each has an exact frozen image; this keeps multi-display selection while
  // removing their capture time from the cursor display's time-to-crosshair.
  void captured.remaining.then(async (remaining) => {
    for (const snap of remaining) {
      if (generation !== openingGeneration || !pending) return
      pending.snapshots.push(snap)
      await showSnapshot(snap)
    }
  }).finally(restoreAppWindows)
  return selection
}

/** Called by the IPC layer when a renderer finishes or aborts a selection. */
export function closeOverlay(selection: OverlaySelection | null): void {
  // Also cancels a snapshot that has started but has not shown its windows yet.
  openingGeneration++
  const current = pending
  pending = null
  if (!current) {
    retireOverlayPoolAfterIdle()
    return
  }
  // The selection is in the coordinate space of these exact images; whoever crops
  // next must use them, not a fresh photograph of a screen that has since changed.
  closedSnapshots =
    selection?.mode === 'region'
      ? current.snapshots.filter((s) => s.displayId === selection.displayId)
      : []

  for (const win of [...current.windows]) {
    if (!win.isDestroyed()) {
      // Hidden pooled renderers used to keep the full PNG, decoded Image, readback canvas
      // and compositor texture until the next capture. Tell them to drop all of it now.
      win.webContents.send(IPC.captureOverlayRelease)
      win.hide()
    }
  }
  retireOverlayPoolAfterIdle()
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
