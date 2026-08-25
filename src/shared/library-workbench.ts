import type { LibraryItem, LibraryWorkbench } from './types'

export type LibraryPathState = 'available' | 'missing' | 'unreadable' | 'incomplete'

export interface LibraryLineageLink {
  state: LibraryPathState
  itemId: string
  title: string
  label: string
}

/** Builds the user-facing relationship projection from verified path states. */
export function buildLibraryWorkbench(
  item: Pick<
    LibraryItem,
    'kind' | 'recovered' | 'projectPath' | 'videoEdit' | 'exportPath' | 'derivedFromId'
  >,
  states: {
    source: LibraryPathState
    project?: LibraryPathState
    export?: LibraryPathState
    lineage?: {
      source?: LibraryLineageLink
      derived?: LibraryLineageLink[]
    }
  }
): LibraryWorkbench {
  const sourceLabel =
    states.source === 'available'
      ? item.recovered
        ? `Recovered ${item.kind === 'image' ? 'capture' : 'recording'}`
        : item.kind === 'image'
          ? 'Original capture'
          : 'Recording'
      : states.source === 'missing'
        ? 'Capture missing or moved'
        : states.source === 'incomplete'
          ? 'Capture incomplete; original preserved'
          : 'Capture unreadable'

  const project = item.derivedFromId
    ? { state: 'linked' as const, label: 'Derived video export' }
    : item.kind === 'video' && item.videoEdit
      ? { state: 'linked' as const, label: 'Video edit draft' }
      : !item.projectPath
        ? { state: 'none' as const, label: 'No editable project' }
        : {
            state: states.project === 'available' ? ('linked' as const) : states.project!,
            label:
              states.project === 'available'
                ? 'Editable project'
                : states.project === 'missing'
                  ? 'Project missing or moved'
                  : states.project === 'incomplete'
                    ? 'Project incomplete'
                    : 'Project unreadable'
          }

  const derived = states.lineage?.derived ?? []
  const derivedState = derived.length
    ? derived.every((link) => link.state === 'available')
      ? ('available' as const)
      : derived.every((link) => link.state === 'missing')
        ? ('missing' as const)
        : ('incomplete' as const)
    : null
  const exportState = item.exportPath ? states.export! : (derivedState ?? ('none' as const))
  const exportLink = {
    state: exportState,
    label:
      exportState === 'available'
        ? item.exportPath
          ? 'Export linked'
          : `${derived.length} derived export${derived.length === 1 ? '' : 's'} available`
        : exportState === 'missing'
          ? item.exportPath
            ? 'Export missing or moved'
            : `${derived.length} derived export${derived.length === 1 ? '' : 's'} missing`
          : exportState === 'unreadable'
            ? 'Export unreadable'
            : exportState === 'incomplete'
              ? item.exportPath
                ? 'Export incomplete'
                : 'Some derived exports need recovery'
              : 'No export linked'
  } as const

  const source = states.lineage?.source
    ? {
        state: states.lineage.source.state,
        label: states.lineage.source.label,
        itemId: states.lineage.source.itemId,
        title: states.lineage.source.title
      }
    : { state: states.source, label: sourceLabel }

  return {
    source,
    project,
    export: {
      ...exportLink,
      ...(derived[0]
        ? {
            itemId: derived[0].itemId,
            title: derived[0].title
          }
        : {})
    },
    derived: derived.map((link) => ({
      state: link.state,
      label: link.label,
      itemId: link.itemId,
      title: link.title
    }))
  }
}
