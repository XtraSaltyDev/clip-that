import { BrowserWindow, nativeImage, screen } from 'electron'
import { IPC } from '@shared/ipc'
import type { CaptureResult } from '@shared/types'
import { loadEntry, preloadPath } from './urls'
import { registerRendererWindow } from '../ipc/sender'

/**
 * The Quick Access card: a small floating window that appears after a capture with the
 * things you actually do next — copy, save, pin, edit, drag into another app — without
 * opening the full editor. The card is the destination; the editor is opt-in.
 */

const CARD_W = 384
const CARD_H = 148

let card: BrowserWindow | null = null

/** Full-resolution results the card can act on, keyed by capture id. */
const cache = new Map<string, { result: CaptureResult; libraryId?: string }>()

export function quickCache(): Map<string, { result: CaptureResult; libraryId?: string }> {
  return cache
}

export function quickWindow(): BrowserWindow | null {
  return card && !card.isDestroyed() ? card : null
}

export function closeQuickAccess(): void {
  if (card && !card.isDestroyed()) card.close()
  card = null
  cache.clear()
}

function makeThumb(result: CaptureResult): string {
  const image = nativeImage.createFromDataURL(result.dataUrl)
  if (image.isEmpty()) return result.dataUrl
  const size = image.getSize()
  const scale = Math.min(1, 560 / Math.max(size.width, size.height, 1))
  return scale < 1
    ? image
        .resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'good'
        })
        .toDataURL()
    : result.dataUrl
}

/**
 * Show (or refresh) the card for a capture. A second capture replaces the card's
 * content — the previous one is already safe in the library.
 */
export function showQuickAccess(result: CaptureResult, libraryId?: string): BrowserWindow {
  // The card only exposes its current capture. Keeping older full-resolution PNG data
  // made up to twelve inaccessible captures survive in the main process.
  cache.clear()
  cache.set(result.id, { result, libraryId })

  const payload = {
    id: result.id,
    thumb: makeThumb(result),
    width: result.width,
    height: result.height
  }

  if (card && !card.isDestroyed()) {
    card.webContents.send(IPC.quickInit, payload)
    card.showInactive()
    return card
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea

  const win = new BrowserWindow({
    x: Math.round(area.x + area.width - CARD_W - 20),
    y: Math.round(area.y + area.height - CARD_H - 20),
    width: CARD_W,
    height: CARD_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    title: 'ClipThat Quick Access',
    webPreferences: {
      preload: preloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  registerRendererWindow(win, 'quick')

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  loadEntry(win, 'hud', 'quick')
  win.webContents.once('did-finish-load', () => win.webContents.send(IPC.quickInit, payload))
  // Never steal focus — the user is mid-flow in another app.
  win.once('ready-to-show', () => win.showInactive())

  card = win
  win.on('closed', () => {
    if (card === win) {
      card = null
      cache.clear()
    }
  })
  return win
}
