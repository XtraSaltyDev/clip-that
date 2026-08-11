import type { ClipDocument } from '@shared/types'

/** The editor fields a direct manipulation must restore when the gesture is cancelled. */
export interface DirectGestureState<THistory = unknown> {
  doc: ClipDocument | null
  past: THistory[]
  future: THistory[]
  dirty: boolean
  selectedIds: string[]
  editingTextId: string | null
}

export type DirectGestureSnapshot<THistory = unknown> = DirectGestureState<THistory>

/**
 * Capture the complete pre-gesture state by reference.
 *
 * The editor store replaces the document, shapes, selection, and history arrays for every
 * mutation; it does not mutate the current document tree in place. Keeping those immutable
 * references is important here because ClipDocument.image is the full-resolution screenshot.
 */
export function captureDirectGestureSnapshot<THistory>(
  state: DirectGestureState<THistory>
): DirectGestureSnapshot<THistory> {
  return {
    doc: state.doc,
    past: state.past,
    future: state.future,
    dirty: state.dirty,
    selectedIds: state.selectedIds,
    editingTextId: state.editingTextId
  }
}

/** Restore a cancelled gesture without copying the document or its image payload. */
export function restoreDirectGestureSnapshot<THistory>(
  snapshot: DirectGestureSnapshot<THistory>
): DirectGestureState<THistory> {
  return snapshot
}

export interface DirectGestureMarker {
  id: string
  cancelled: boolean
}

export function cancelDirectGesture<T extends DirectGestureMarker>(gesture: T): T {
  return { ...gesture, cancelled: true }
}

export function isCancelledDirectGesture(gesture: DirectGestureMarker | null, id: string): boolean {
  return gesture?.id === id && gesture.cancelled
}
