/** Identify our windows by native ID; other apps can legitimately use the same title. */
export function shouldIncludeWindowSource(
  sourceName: string,
  sourceId: string,
  appSourceIds: readonly string[],
  visibleEditorSourceIds: readonly string[]
): boolean {
  if (!sourceName.trim()) return false
  const nativeId = /^window:(\d+):/.exec(sourceId)?.[1]
  const matches = (candidate: string) => {
    return (
      candidate === sourceId ||
      (nativeId !== undefined && /^window:(\d+):/.exec(candidate)?.[1] === nativeId)
    )
  }
  return !appSourceIds.some(matches) || visibleEditorSourceIds.some(matches)
}
