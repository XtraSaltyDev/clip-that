import type { LibraryOpenBehavior } from '@shared/types'

export type LibraryOpenAction = 'ask' | 'existing' | 'new' | 'cancel'

/** No choice is needed until there is an editor window that can be reused. */
export function initialLibraryOpenAction(
  preference: LibraryOpenBehavior,
  hasEditor: boolean
): LibraryOpenAction {
  return hasEditor ? preference : 'new'
}

/** Native dialog buttons are ordered Existing, New, Cancel. */
export function libraryOpenActionFromResponse(response: number): LibraryOpenAction {
  if (response === 0) return 'existing'
  if (response === 1) return 'new'
  return 'cancel'
}

/** Save only an affirmative choice; cancelling never changes the user's preference. */
export function savedLibraryOpenBehavior(
  action: LibraryOpenAction,
  doNotAskAgain: boolean
): LibraryOpenBehavior | null {
  if (!doNotAskAgain || (action !== 'existing' && action !== 'new')) return null
  return action
}
