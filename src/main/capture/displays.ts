import { screen } from 'electron'
import type { DisplayInfo, Rect } from '@shared/types'

export function toDisplayInfo(d: Electron.Display, primaryId: number, index: number): DisplayInfo {
  return {
    id: String(d.id),
    bounds: { ...d.bounds },
    workArea: { ...d.workArea },
    scaleFactor: d.scaleFactor,
    rotation: d.rotation,
    internal: Boolean((d as { internal?: boolean }).internal),
    primary: d.id === primaryId,
    label: d.label || `Display ${index + 1}`
  }
}

export function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => toDisplayInfo(d, primaryId, i))
}

export function findDisplay(id: string): Electron.Display | undefined {
  return screen.getAllDisplays().find((d) => String(d.id) === id)
}

/** The display whose bounds contain the cursor. */
export function displayUnderCursor(): Electron.Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

/** Union of every display's bounds — the whole virtual desktop, in DIPs. */
export function virtualDesktopBounds(): Rect {
  const displays = screen.getAllDisplays()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x)
    minY = Math.min(minY, d.bounds.y)
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width)
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Pixel dimensions of a display, accounting for rotation. */
export function displayPixelSize(d: Electron.Display): { width: number; height: number } {
  return {
    width: Math.round(d.bounds.width * d.scaleFactor),
    height: Math.round(d.bounds.height * d.scaleFactor)
  }
}
