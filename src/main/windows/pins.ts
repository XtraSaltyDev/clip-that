import { BrowserWindow, nativeImage, screen } from 'electron'
import { IPC } from '@shared/ipc'
import { loadEntry, preloadPath } from './urls'
import { registerRendererWindow } from '../ipc/sender'

/**
 * Pinned screenshots: frameless, always-on-top image windows the user parks anywhere
 * as reference while working. The feature CleanShot and Shottr users won't live without.
 */

const pins = new Set<BrowserWindow>()

export function pinCount(): number {
  return [...pins].filter((w) => !w.isDestroyed()).length
}

export function closeAllPins(): void {
  for (const w of pins) if (!w.isDestroyed()) w.close()
  pins.clear()
}

/**
 * Open a pin showing `dataUrl`. Sized to the image's DIP size, capped to 45% of the
 * display so a full-screen capture pins as a card rather than a second monitor.
 */
export function createPin(
  dataUrl: string,
  opts: { scaleFactor?: number; near?: { x: number; y: number } } = {}
): BrowserWindow | null {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) return null
  const size = image.getSize()
  const scaleFactor = opts.scaleFactor ?? 1
  const dipW = size.width / scaleFactor
  const dipH = size.height / scaleFactor

  const display = opts.near
    ? screen.getDisplayNearestPoint(opts.near)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea

  const cap = Math.min((area.width * 0.45) / dipW, (area.height * 0.45) / dipH, 1)
  const width = Math.max(120, Math.round(dipW * cap))
  const height = Math.max(80, Math.round(dipH * cap))

  // Stagger pins so several don't stack invisibly on top of each other.
  const offset = (pinCount() % 5) * 28
  const x = Math.round(area.x + area.width - width - 24 - offset)
  const y = Math.round(area.y + 24 + offset)

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    minWidth: 80,
    minHeight: 60,
    title: 'ClipThat Pin',
    webPreferences: {
      preload: preloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  registerRendererWindow(win, 'pin')

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  })
  // Resizing keeps the image's shape — a stretched screenshot is worse than none.
  win.setAspectRatio(width / height)

  loadEntry(win, 'hud', 'pin')
  win.webContents.once('did-finish-load', () => {
    win.webContents.send(IPC.pinInit, { dataUrl, width: size.width, height: size.height })
  })
  win.once('ready-to-show', () => win.showInactive())

  pins.add(win)
  win.on('closed', () => pins.delete(win))
  return win
}
