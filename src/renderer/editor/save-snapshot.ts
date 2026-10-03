import type { ClipDocument } from '@shared/types'

export interface EditorSaveSnapshot {
  doc: ClipDocument
  libraryId: string | null
  epoch: number
}

/** Identity survives title changes but not a handoff, even when reopening the same capture. */
export function isSaveDocumentCurrent(
  current: { doc: ClipDocument | null; documentEpoch: number },
  saved: EditorSaveSnapshot
): boolean {
  return current.documentEpoch === saved.epoch && current.doc?.id === saved.doc.id
}

/** A completed save may clear dirty state only for the exact immutable revision it saved. */
export function isSaveRevisionCurrent(
  current: { doc: ClipDocument | null; documentEpoch: number },
  saved: EditorSaveSnapshot
): boolean {
  return isSaveDocumentCurrent(current, saved) && current.doc === saved.doc
}
