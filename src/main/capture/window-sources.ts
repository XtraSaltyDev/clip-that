import { sameWindowSource } from '../../shared/window-source'

export { nativeWindowSourceId, sameWindowSource } from '../../shared/window-source'

/** Identify our windows by native ID; other apps can legitimately use the same title. */
export function shouldIncludeWindowSource(
  sourceName: string,
  sourceId: string,
  appSourceIds: readonly string[],
  visibleEditorSourceIds: readonly string[]
): boolean {
  if (!sourceName.trim()) return false
  const matches = (candidate: string) => sameWindowSource(candidate, sourceId)
  return !appSourceIds.some(matches) || visibleEditorSourceIds.some(matches)
}
