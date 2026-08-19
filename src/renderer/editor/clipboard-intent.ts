export type EditorCopyTarget = 'text' | 'annotations' | 'image'

/** Keep clipboard precedence explicit so keyboard behavior cannot drift between releases. */
export function editorCopyTarget(
  hasLiveTextSelection: boolean,
  annotationSelectionCount: number
): EditorCopyTarget {
  if (hasLiveTextSelection) return 'text'
  if (annotationSelectionCount > 0) return 'annotations'
  return 'image'
}
