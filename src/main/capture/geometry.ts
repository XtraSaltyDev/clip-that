import type { DisplayInfo, Rect } from '@shared/types'

function area(a: Rect, b: Rect): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

export function displayForRect(
  rect: Rect,
  displays: readonly DisplayInfo[]
): DisplayInfo | undefined {
  return [...displays].sort((a, b) => area(b.bounds, rect) - area(a.bounds, rect))[0]
}

/** Convert a global-DIP rectangle to source pixels for one display, including negative origins. */
export function dipRectToDisplayPixels(rect: Rect, display: DisplayInfo): Rect {
  return {
    x: Math.round((rect.x - display.bounds.x) * display.scaleFactor),
    y: Math.round((rect.y - display.bounds.y) * display.scaleFactor),
    width: Math.round(rect.width * display.scaleFactor),
    height: Math.round(rect.height * display.scaleFactor)
  }
}

export function validRect(rect: Rect): boolean {
  return (
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0
  )
}
