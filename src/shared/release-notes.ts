import type { ReleaseNotes, ReleaseNotesStatus } from './types'

/**
 * Release notes ship with the app so the What's New page remains useful when
 * the public update channel is unavailable or the device is offline.
 */
export const RELEASE_NOTES = [
  {
    version: '0.1.6',
    title: 'Capture, edit and save with less friction',
    summary: 'The latest release keeps new captures close to the editor while making saved stills easier to revisit and update.',
    items: [
      {
        title: 'New captures open in the editor',
        body: 'Captures are added to the Library before the editor opens, so your work is available in both places without an extra save step.'
      },
      {
        title: 'Save As remembers the still you chose',
        body: 'After Save As, Save writes back to that still until you choose another destination. The editable capture keeps the link in the Library.'
      },
      {
        title: 'The active editor stays the active workspace',
        body: 'When a capture is routed into an existing editor, ClipThat reuses the focused or most recently focused editor window.'
      }
    ]
  }
] as const satisfies readonly ReleaseNotes[]

/** Select only the notes authored for this exact app version. */
export function releaseNotesForVersion(
  version: string,
  catalog: readonly ReleaseNotes[] = RELEASE_NOTES
): ReleaseNotes | null {
  return catalog.find((notes) => notes.version === version) ?? null
}

/** Derive the renderer-facing notes and one-time unread state. */
export function releaseNotesStatus(
  currentVersion: string,
  lastSeenVersion: string | null,
  catalog: readonly ReleaseNotes[] = RELEASE_NOTES
): ReleaseNotesStatus {
  const notes = releaseNotesForVersion(currentVersion, catalog)
  return {
    currentVersion,
    lastSeenVersion,
    notes,
    unread: notes !== null && lastSeenVersion !== currentVersion
  }
}
