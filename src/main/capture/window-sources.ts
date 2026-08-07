/**
 * Keep ClipThat editors capturable while excluding the app's overlay, HUD, library,
 * settings and quick-access windows from the window picker.
 *
 * Electron reports either the document title alone or `App — Document`, depending on
 * the platform. Matching the titles of currently visible editor BrowserWindows covers
 * both forms without exposing every internal ClipThat window.
 */
export function shouldIncludeWindowSource(
  sourceName: string,
  visibleEditorTitles: readonly string[]
): boolean {
  const name = sourceName.trim()
  if (!name) return false
  if (!name.startsWith('ClipThat')) return true

  return visibleEditorTitles.some((candidate) => {
    const title = candidate.trim()
    return title.length > 0 && (name === title || name.endsWith(` — ${title}`))
  })
}
