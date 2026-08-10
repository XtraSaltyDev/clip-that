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
  },
  {
    version: '0.1.7',
    title: 'A smoother capture-to-save workflow',
    summary: 'New captures now stay connected to the Library and editor, while release notes make each update easier to understand.',
    items: [
      {
        title: 'Captures are saved to the Library first',
        body: 'New captures use the default title, appear in the Library immediately, and open in the editor without an extra manual save.'
      },
      {
        title: 'The editor window is reused',
        body: 'New captures open in the focused or most recently focused editor instead of creating another editor window.'
      },
      {
        title: 'Save As keeps your title and file',
        body: 'A Save As rename updates the editor and Library, and later Saves overwrite the selected still until you choose another destination.'
      },
      {
        title: 'Review changes inside ClipThat',
        body: 'Open Settings → What’s New to review the notes for the current release. The section stays available offline after installation.'
      }
    ]
  },
  {
    version: '0.1.8',
    title: 'More capable annotation and import workflows',
    summary: 'Rotate and reshape annotations, mark up screenshots faster, and bring supported Snagit captures into the Library.',
    items: [
      {
        title: 'Rotate annotations precisely',
        body: 'Use the canvas rotation handle or enter an exact angle in the Inspector, then reset it to zero when needed.'
      },
      {
        title: 'Horizontal and vertical tilt are distinct',
        body: 'The two canvas tilt controls now apply to their labeled visible axes and retain their meaning when the project is reopened.'
      },
      {
        title: 'Cut Out image sections',
        body: 'Remove a horizontal or vertical band with a straight, zigzag, wave, or triangle edge while keeping the edit reversible.'
      },
      {
        title: 'Add Step markers continuously',
        body: 'Choose Step once and keep clicking to place the next number until you press Escape or choose another tool.'
      },
      {
        title: 'Import supported Snagit captures',
        body: 'Scan a Snagit library, review supported media and duplicates, then import copies into the ClipThat Library without changing the source files.'
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
