export const EDITOR_COMPACT_MAX_WIDTH = 1100

export const COMPACT_OVERFLOW_ACTIONS = [
  'context',
  'auto-blur',
  'drag-out',
  'command-palette',
  'capture-region',
  'capture-window',
  'capture-display',
  'capture-scrolling',
  'capture-clipboard',
  'record-screen',
  'library',
  'settings'
] as const

export function compactEditorQuery(): string {
  return `(max-width: ${EDITOR_COMPACT_MAX_WIDTH}px)`
}

export function inspectorStartsCollapsed(width: number): boolean {
  return width <= EDITOR_COMPACT_MAX_WIDTH
}

export function nextMenuIndex(
  current: number,
  count: number,
  key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'
): number {
  if (count <= 0) return -1
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowDown') return (current + 1 + count) % count
  return (current - 1 + count) % count
}
