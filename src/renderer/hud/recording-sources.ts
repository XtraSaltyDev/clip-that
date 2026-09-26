import type { DisplayInfo, RecordingOptions, WindowInfo } from '@shared/types'
import { sameWindowSource } from '../../shared/window-source'

/** Keep persisted source choices honest when windows close or the display layout changes. */
export function reconcileRecordingSources(
  options: RecordingOptions,
  displays: readonly DisplayInfo[],
  windows: readonly WindowInfo[]
): RecordingOptions {
  const displayId = displays.some((display) => display.id === options.displayId)
    ? options.displayId
    : (displays.find((display) => display.primary) ?? displays[0])?.id
  const selectedWindow = options.windowId
    ? windows.find((window) => sameWindowSource(window.id, options.windowId!))
    : undefined
  const windowId = selectedWindow?.id

  const region =
    options.target === 'region' && displayId === options.displayId ? options.region : undefined
  return { ...options, displayId, windowId, region }
}
