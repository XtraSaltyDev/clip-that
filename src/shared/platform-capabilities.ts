import type { CapabilityState, PlatformCapability, PlatformCapabilityId } from './types'

const LABELS: Record<PlatformCapabilityId, string> = {
  'capture.region': 'Region capture',
  'capture.display': 'Screen capture',
  'capture.window': 'Window capture',
  'capture.clipboard': 'Clipboard capture',
  'capture.repeat': 'Repeat last region',
  'capture.delayed': 'Delayed capture',
  'capture.scrolling': 'Scrolling capture',
  'record.display': 'Screen recording',
  'record.window': 'Window recording',
  'record.region': 'Region recording',
  'record.microphone': 'Microphone recording',
  'record.system-audio': 'System audio recording',
  'record.webcam': 'Webcam overlay',
  'record.pause-resume': 'Pause and resume',
  'export.mp4': 'MP4 export',
  'export.webm': 'WebM export',
  'export.gif': 'GIF export',
  'update.in-app': 'In-app updates'
}

const CAPTURE_IDS: PlatformCapabilityId[] = [
  'capture.region',
  'capture.display',
  'capture.window',
  'capture.clipboard',
  'capture.repeat',
  'capture.delayed',
  'capture.scrolling'
]
const RECORD_IDS: PlatformCapabilityId[] = [
  'record.display',
  'record.window',
  'record.region',
  'record.microphone',
  'record.system-audio',
  'record.webcam',
  'record.pause-resume'
]
const EXPORT_IDS: PlatformCapabilityId[] = ['export.mp4', 'export.webm', 'export.gif']

function entry(
  id: PlatformCapabilityId,
  state: CapabilityState,
  detail: string,
  runtimeVerified = false
): PlatformCapability {
  return { id, label: LABELS[id], state, detail, runtimeVerified }
}

/** Static product contract. Runtime preflight may only make this more specific, never greener. */
export function platformCapabilityMatrix(
  platform: NodeJS.Platform,
  runtimeAccepted = false
): PlatformCapability[] {
  if (platform === 'darwin') {
    return [
      ...CAPTURE_IDS.map((id) => entry(id, 'supported', 'Available on macOS', runtimeAccepted)),
      ...RECORD_IDS.map((id) => entry(id, 'supported', 'Available on macOS', runtimeAccepted)),
      ...EXPORT_IDS.map((id) =>
        entry(id, 'supported', 'Uses bundled audited FFmpeg', runtimeAccepted)
      ),
      entry('update.in-app', 'supported', 'Signed Apple silicon releases only', runtimeAccepted)
    ]
  }

  if (platform === 'win32') {
    return [
      ...CAPTURE_IDS.map((id) =>
        entry(
          id,
          'unverified',
          'Implemented for the unsigned Windows preview; real-hardware acceptance pending'
        )
      ),
      ...RECORD_IDS.map((id) =>
        entry(
          id,
          'unverified',
          'Implemented for the unsigned Windows preview; verify devices and source at preflight'
        )
      ),
      ...EXPORT_IDS.map((id) =>
        entry(
          id,
          'unverified',
          'Bundled encoder is checked before export; Windows hardware acceptance pending'
        )
      ),
      entry('update.in-app', 'unavailable', 'Unsigned Windows previews use manual downloads only')
    ]
  }

  return [
    ...CAPTURE_IDS.map((id) => entry(id, 'unverified', 'Not runtime-accepted on this platform')),
    ...RECORD_IDS.map((id) => entry(id, 'unverified', 'Not runtime-accepted on this platform')),
    ...EXPORT_IDS.map((id) =>
      entry(id, 'unverified', 'Bundled media toolchain not runtime-accepted')
    ),
    entry('update.in-app', 'unavailable', 'In-app updates are not enabled on this platform')
  ]
}

export function capabilitySummary(capabilities: readonly PlatformCapability[]): string {
  return capabilities.map((item) => `${item.label}: ${item.state} — ${item.detail}`).join('\n')
}
