import type { ReleaseNotes, ReleaseNotesStatus } from './types'

/**
 * Release notes ship with the app so the What's New page remains useful when
 * the public update channel is unavailable or the device is offline.
 */
export const RELEASE_NOTES = [
  {
    version: '0.1.6',
    title: 'Capture, edit and save with less friction',
    summary:
      'The latest release keeps new captures close to the editor while making saved stills easier to revisit and update.',
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
    summary:
      'New captures now stay connected to the Library and editor, while release notes make each update easier to understand.',
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
    summary:
      'Rotate and reshape annotations, mark up screenshots faster, and bring supported Snagit captures into the Library.',
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
  },
  {
    version: '0.1.9',
    title: 'Rotation polish and reliability hardening',
    summary:
      'Keep annotation controls reachable while strengthening saves, diagnostics, OCR recovery, and build checks.',
    items: [
      {
        title: 'Rotate handles stay reachable',
        body: 'The rotate control now avoids the annotation toolbar and remains available at canvas edges, including rotated selections.'
      },
      {
        title: 'Annotation geometry stays stable',
        body: 'Text, boxes, arrows, and other annotations retain their position and size through transforms and reopen correctly.'
      },
      {
        title: 'More resilient app sessions',
        body: 'Long logs rotate safely, ordinary settings save immediately, and OCR workers report failures instead of waiting for the full timeout.'
      }
    ]
  },
  {
    version: '0.1.10',
    title: 'Direct line editing and safer canvas control',
    summary:
      'Reshape arrows, lines, and measurements directly while keeping annotations selectable, readable, and recoverable near canvas edges.',
    items: [
      {
        title: 'Drag either endpoint directly',
        body: 'Select a line, arrow, or measurement and drag either end to change its direction and length while the opposite end stays anchored.'
      },
      {
        title: 'Measurements remain readable and editable',
        body: 'Measurement labels follow curved and angled lines more clearly, and measurements can be reselected and moved after placement.'
      },
      {
        title: 'Annotations stay within reach',
        body: 'Dragging single or grouped annotations near the canvas boundary keeps enough selectable geometry available to recover and continue editing them.'
      },
      {
        title: 'Selection controls behave consistently',
        body: 'Rotation, direct manipulation, cancellation, undo, and redo now share a more predictable control lifecycle across editor zoom levels.'
      }
    ]
  },
  {
    version: '0.1.11',
    title: 'More room for annotations',
    summary:
      'Add notes beyond a small capture while keeping editor controls cleaner and annotations recoverable throughout the canvas.',
    items: [
      {
        title: 'The canvas grows with your annotations',
        body: 'Move arrows, measurements, text, and other annotations beyond a capture edge and ClipThat adds space on only the sides that need it. The added space is preserved when you reopen or export the capture.'
      },
      {
        title: 'Expansion stays undoable',
        body: 'Annotation movement and its required canvas expansion are one undoable action, so Undo and Redo restore the annotation and canvas together.'
      },
      {
        title: 'Rotation controls are cleaner',
        body: 'The rotate control keeps its reachable circular handle without the connector line between the handle and selection.'
      },
      {
        title: 'Edge editing is more dependable',
        body: 'Annotations remain selectable after outside-canvas drags, across editor zoom levels, with more reliable cancellation, history, and toolbar behavior.'
      }
    ]
  },
  {
    version: '0.1.12',
    title: 'Native Mac system audio',
    summary:
      'Record the sound your Mac plays without installing or configuring a separate virtual audio device.',
    items: [
      {
        title: 'Capture system audio natively',
        body: 'On macOS 13 or later, enable System audio before recording to capture meeting and application sound using the built-in macOS permission.'
      },
      {
        title: 'Clear first-use guidance',
        body: 'ClipThat now explains that macOS may ask for audio-capture permission the first time you enable system audio.'
      }
    ]
  },
  {
    version: '0.1.13',
    title: 'A safer, more transparent release',
    summary:
      'ClipThat now ships through a hardened public release pipeline with auditable media and OCR dependencies.',
    items: [
      {
        title: 'Auditable bundled components',
        body: 'The packaged OCR assets, JavaScript dependencies, and Apple-silicon media tools are pinned to verified sources with their license and provenance records included.'
      },
      {
        title: 'Safer update checks',
        body: 'Update availability is checked only against the public ClipThat GitHub release channel, and downloads still begin only after you explicitly request them.'
      },
      {
        title: 'Stronger release verification',
        body: 'Every supported Mac release is checked for Developer ID signing, hardened runtime, Apple notarization, expected architecture, bundled licenses, and accidental secrets before publication.'
      }
    ]
  },
  {
    version: '0.1.14',
    title: 'Faster capture and annotation reuse',
    summary:
      'Copy fresh captures automatically and reuse annotations through native editor context menus.',
    items: [
      {
        title: 'Automatically copy new captures',
        body: 'Enable the new Capture setting to copy each new screenshot to the clipboard while preserving your existing after-capture workflow.'
      },
      {
        title: 'Right-click editing',
        body: 'Right-click the canvas or an annotation selection to access relevant copy, paste, duplicate, select, and delete actions.'
      },
      {
        title: 'Reuse annotations across clips',
        body: 'Copy one or more annotations and paste them into another open clip without replacing the image or text already on your system clipboard.'
      }
    ]
  },
  {
    version: '0.1.15',
    title: 'Keyboard annotation workflows and stronger safeguards',
    summary:
      'Reuse annotations more quickly from the keyboard while ClipThat adds broader release checks and stricter clipboard validation.',
    items: [
      {
        title: 'Copy and paste selected annotations',
        body: 'Press Command-C with annotations selected, then Command-V in the same or another open clip. Live Text selection still takes precedence when active.'
      },
      {
        title: 'Open context actions from the keyboard',
        body: 'Use Shift-F10 or the keyboard Context Menu key to open the same annotation and canvas actions available by right-clicking.'
      },
      {
        title: 'Safer clipboard and release boundaries',
        body: 'Annotation data is validated before it crosses the system clipboard boundary, and new automated checks cover persistence, updater metadata, release consistency, and protocol behavior.'
      },
      {
        title: 'Clearer controls for assistive technology',
        body: 'Previously unlabeled editor, capture, recording, Library, and Settings controls now expose meaningful accessible names.'
      }
    ]
  },
  {
    version: '0.1.16',
    title: 'Responsive workflows and trustworthy text',
    summary:
      'ClipThat adapts more cleanly across window sizes while Screen Context and Library search distinguish reliable text from OCR noise.',
    items: [
      {
        title: 'Responsive Library and Settings',
        body: 'Library controls, capture grids, details, and Settings fields now adapt to compact windows without hiding essential actions.'
      },
      {
        title: 'A focused compact editor',
        body: 'The editor condenses its header and annotation tools at smaller sizes, with grouped tools and a collapsible inspector that preserve the full workflow.'
      },
      {
        title: 'Trustworthy Screen Context',
        body: 'OCR confidence now determines which detected text, entities, tables, and sensitive-data suggestions are presented as reliable, while raw text remains available for review.'
      },
      {
        title: 'Safer Library search migration',
        body: 'Existing image captures are reindexed in bounded background batches so only confidence-qualified OCR becomes searchable; source captures and user metadata remain unchanged.'
      }
    ]
  },
  {
    version: '0.1.17',
    title: 'Guides, clearer editing, and a stronger Windows preview',
    summary:
      'Turn captures into reusable guides, find annotation tools faster, and try a more capable experimental Windows build.',
    items: [
      {
        title: 'Build guides from captures',
        body: 'Create step-by-step guides from new or existing captures, reorder and describe each step, and export portable JSON, HTML, or Markdown without sending content to a service.'
      },
      {
        title: 'Find editor tools faster',
        body: 'Select stays one click away while the remaining annotation tools are organized into five focused drawers with clear names, short explanations, and keyboard shortcuts.'
      },
      {
        title: 'A more consistent workspace',
        body: 'Library, editor, recorder, and Settings surfaces now share clearer spacing, control hierarchy, responsive behavior, and accessible status language.'
      },
      {
        title: 'Safer recording preparation and recovery',
        body: 'Recording readiness now reports capture-source and encoder problems more clearly, preserves recoverable data, and avoids claiming success when required capabilities are unavailable.'
      },
      {
        title: 'Unsigned experimental Windows preview',
        body: 'The Windows x64 setup, portable app, and ZIP now bundle audited FFmpeg and ffprobe tools for WebM recording plus MP4 and GIF export. This preview remains unsigned and requires real-hardware testing.'
      }
    ]
  },
  {
    version: '0.1.18',
    title: 'A clearer capture-to-output workflow',
    summary:
      'Take the next useful action faster, understand which captured text is trustworthy, and keep recordings connected to their reusable outputs.',
    items: [
      {
        title: 'A visible capture handoff',
        body: 'New image and recording captures open with clear actions for editing, copying, saving, revealing, dragging out, pinning, and running the configured local pipeline.'
      },
      {
        title: 'Context you can trust',
        body: 'Screen Context now distinguishes processing, trusted, uncertain, partial, empty, and failed analysis while keeping raw captures and text available for recovery.'
      },
      {
        title: 'Library as a workbench',
        body: 'Denser scanning, explicit recovery states, and source, project, and export relationships make larger capture collections easier to reuse.'
      },
      {
        title: 'Aspect-aware recording exports',
        body: 'Local recordings support original, landscape, square, and vertical framing with understandable export presets, persisted drafts, and lineage back to the source recording.'
      }
    ]
  },
  {
    version: '0.1.19',
    title: 'Installed-app polish for everyday Mac capture',
    summary:
      'First-run and hotkeys behave more predictably, Screen Context actions work on recovered text, and Quick Access drag-out plus recording review are more reliable.',
    items: [
      {
        title: 'A steadier first run',
        body: 'Welcome stays until you continue, try-it-now captures wait for verified Screen Recording permission, and launch-at-login stays in sync on every start.'
      },
      {
        title: 'Clearer shortcut conflicts',
        body: 'Duplicate hotkeys are surfaced in Settings so conflicting bindings are easier to notice and fix.'
      },
      {
        title: 'Context actions on recovered text',
        body: 'Partial OCR results can still drive auto-blur, open-link, and table copy when enough trusted text is available.'
      },
      {
        title: 'More reliable Quick Access drag-out',
        body: 'Drag-out starts from the Library file immediately, stays hittable, and pastes cleanly into other Mac apps.'
      },
      {
        title: 'Recording capture and review fixes',
        body: 'System audio uses loopback instead of a hanging mix, HUD review remuxes WebM for playback, and Repeat last region is available from the File menu, palettes, and Welcome.'
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
