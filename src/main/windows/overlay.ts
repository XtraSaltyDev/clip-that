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
 * Freeze every display, then float a borderless window over each one so the user can
 * select against a still image. Selecting over a live screen is what makes other tools
 * lose hover states and open menus; freezing first is why this one doesn't.
 */
export async function openOverlay(mode: OverlayMode): Promise<OverlaySelection | null> {
  if (pending) closeOverlay(null)

  const snapshots = await withAppWindowsHidden(snapshotAllDisplays)
  if (snapshots.length === 0) return null

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

  for (const snap of snapshots) {
    const display = screen.getAllDisplays().find((d) => String(d.id) === snap.displayId)
    if (!display) continue

    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
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
    win.setBounds(display.bounds)

    loadEntry(win, 'overlay')

    win.webContents.once('did-finish-load', () => {
      win.webContents.send('overlay:init', {
        mode,
        snapshot: snap,
        displayCount: snapshots.length
      })
    })

    win.once('ready-to-show', () => {
      win.setBounds(display.bounds)
      win.show()
      // Only the display under the cursor takes keyboard focus, so Escape lands somewhere sane.
      const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      if (cursorDisplay.id === display.id) win.focus()
    })

    win.on('closed', () => {
      const idx = windows.indexOf(win)
      if (idx >= 0) windows.splice(idx, 1)
    })

    windows.push(win)
  }

  if (windows.length === 0) return null

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
    if (!win.isDestroyed()) {
      win.setClosable(true)
      win.close()
    }
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
