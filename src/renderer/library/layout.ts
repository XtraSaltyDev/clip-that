import type { LibraryItem } from '@shared/types'

const GRID_CARD_MIN = 220
const GRID_GAP = 14
const MAIN_HORIZONTAL_PADDING = 32
const DAY = 86_400_000

/** The same column calculation used by the CSS grid, shared with keyboard navigation. */
export function libraryGridColumns(mainWidth: number): number {
  const contentWidth = Math.max(0, mainWidth - MAIN_HORIZONTAL_PADDING)
  return Math.max(1, Math.floor((contentWidth + GRID_GAP) / (GRID_CARD_MIN + GRID_GAP)))
}

/** Bucket captures into Today / Yesterday / weekday / date headings without reordering them. */
export function groupLibraryItems(
  items: LibraryItem[],
  now = Date.now()
): Array<{ label: string; items: LibraryItem[] }> {
  const startOfDay = (timestamp: number) => {
    const date = new Date(timestamp)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  const today = startOfDay(now)

  const groups: Array<{ label: string; items: LibraryItem[] }> = []
  for (const item of items) {
    const start = startOfDay(item.createdAt)
    const age = Math.round((today - start) / DAY)
    const label =
      age <= 0
        ? 'Today'
        : age === 1
          ? 'Yesterday'
          : age < 7
            ? new Date(item.createdAt).toLocaleDateString(undefined, { weekday: 'long' })
            : new Date(item.createdAt).toLocaleDateString(undefined, {
                month: 'long',
                day: 'numeric',
                year: start < today - DAY * 300 ? 'numeric' : undefined
              })
    const last = groups[groups.length - 1]
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}
