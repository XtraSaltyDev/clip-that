import type { LibraryItem } from '@shared/types'

export const GRID_CARD_MIN = 196
export const GRID_GAP = 10
export const MAIN_HORIZONTAL_PADDING = 24
const DAY = 86_400_000

/** The same column calculation used by the CSS grid, shared with keyboard navigation. */
export function libraryGridColumns(mainWidth: number): number {
  const contentWidth = Math.max(0, mainWidth - MAIN_HORIZONTAL_PADDING)
  return Math.max(1, Math.floor((contentWidth + GRID_GAP) / (GRID_CARD_MIN + GRID_GAP)))
}

export function libraryQueryIsActive(search: string, filter: string, tag: string): boolean {
  return Boolean(search.trim() || filter !== 'all' || tag)
}

export function libraryEmptyState(
  search: string,
  filter: string,
  tag: string
): {
  title: string
  detail: string
} {
  if (libraryQueryIsActive(search, filter, tag)) {
    return {
      title: 'Nothing matched these filters',
      detail: 'Try a different search, remove a filter, or clear the tag.'
    }
  }
  return {
    title: 'Your Library is empty',
    detail: 'Capture or import something to start building your workbench.'
  }
}

/** Bucket captures into Today / Yesterday / weekday / date headings without reordering them. */
export function groupLibraryItems<T extends LibraryItem>(
  items: T[],
  now = Date.now()
): Array<{ label: string; items: T[] }> {
  const startOfDay = (timestamp: number) => {
    const date = new Date(timestamp)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  const today = startOfDay(now)

  const groups: Array<{ label: string; items: T[] }> = []
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
