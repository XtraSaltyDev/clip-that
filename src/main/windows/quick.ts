import { BrowserWindow, nativeImage, nativeTheme, screen } from 'electron'
import { IPC } from '@shared/ipc'
import type { CaptureResult, LibraryItem } from '@shared/types'
import { loadEntry, preloadPath } from './urls'
import { registerRendererWindow } from '../ipc/sender'
import { settings } from '../store/settings'

/**
 * The capture handoff strip: a small floating window that appears after a capture with
 * the things you actually do next without opening the full editor. The strip is the
 * destination; the editor is opt-in.
 */

const CARD_W = 624
const CARD_H = 184
const IS_MAC = process.platform === 'darwin'

let card: BrowserWindow | null = null

/** Full-resolution results the card can act on, keyed by capture id. */
export type QuickEntry =
  | { kind: 'image'; result: CaptureResult; libraryId?: string }
  | { kind: 'video'; item: LibraryItem }

const cache = new Map<string, QuickEntry>()

export function quickCache(): Map<string, QuickEntry> {
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

function libraryFileUrl(filePath: string): string {
  return `clipthat://file/${encodeURIComponent(filePath)}`
}

function panelBackground(): string {
  const theme = settings.get().theme
  const light =
    theme === 'light' || (theme === 'system' && nativeTheme.shouldUseDarkColors === false)
  return light ? '#ffffff' : '#12161d'
}

interface QuickPayload {
  id: string
  kind: 'image' | 'video'
  thumb: string
  title: string
  width: number
  height: number
  durationMs?: number
}

function present(entry: QuickEntry, payload: QuickPayload): BrowserWindow {
  // The card only exposes its current capture. Keeping older full-resolution PNG data
  // made up to twelve inaccessible captures survive in the main process.
  cache.clear()
  cache.set(payload.id, entry)

  if (card && !card.isDestroyed()) {
    card.setBackgroundColor(panelBackground())
    card.webContents.send(IPC.quickInit, payload)
    card.show()
    card.focus()
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
    transparent: false,
    backgroundColor: panelBackground(),
    hasShadow: true,
    roundedCorners: true,
    ...(IS_MAC ? { type: 'panel' as const } : {}),
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    focusable: true,
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
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  })

  loadEntry(win, 'hud', 'quick')
  win.webContents.once('did-finish-load', () => win.webContents.send(IPC.quickInit, payload))
  // The handoff is the next step in the capture flow, so keyboard users should land
  // on its action controls without having to find the card with the mouse.
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })

  card = win
  win.on('closed', () => {
    if (card === win) {
      card = null
      cache.clear()
    }
  })
  return win
}

/** Show (or refresh) the handoff for an image capture. */
export function showQuickAccess(result: CaptureResult, libraryId?: string): BrowserWindow {
  return present(
    { kind: 'image', result, libraryId },
    {
      id: result.id,
      kind: 'image',
      thumb: makeThumb(result),
      title: result.title ?? 'Image capture',
      width: result.width,
      height: result.height
    }
  )
}

/** Show the same handoff after a recording has been encoded into the Library. */
export function showQuickAccessItem(item: LibraryItem): BrowserWindow {
  return present(
    { kind: 'video', item },
    {
      id: item.id,
      kind: 'video',
      thumb: item.thumbnail ? libraryFileUrl(item.thumbnail) : '',
      title: item.title,
      width: item.width,
      height: item.height,
      durationMs: item.durationMs
    }
  )
}
