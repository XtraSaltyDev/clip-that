import type { CapabilityState, RecordingPreflightItem } from '@shared/types'

const FAILURE_STATES = new Set<CapabilityState>(['unavailable', 'permission-error', 'device-error'])

export const capabilityStateLabel = (state: CapabilityState): string =>
  ({
    supported: 'Ready',
    unavailable: 'Unavailable',
    unverified: 'Unverified',
    'permission-error': 'Permission needed',
    'device-error': 'Device error'
  })[state]

export function recordingReadiness(
  items: RecordingPreflightItem[],
  canStart: boolean,
  busy = false
): {
  tone: 'checking' | 'ready' | 'warning' | 'blocked'
  title: string
  detail: string
  actionItems: RecordingPreflightItem[]
} {
  if (busy) {
    return {
      tone: 'checking',
      title: 'Checking recording setup…',
      detail: 'Source, devices, export tools and destination',
      actionItems: []
    }
  }

  const failures = items.filter((item) => FAILURE_STATES.has(item.state))
  const unverified = items.filter((item) => item.state === 'unverified')
  const actionItems = [...failures, ...unverified]

  if (canStart && unverified.length === 0) {
    return {
      tone: 'ready',
      title: 'Ready to record',
      detail: 'The selected source and requested devices passed preflight.',
      actionItems: []
    }
  }
  if (canStart) {
    return {
      tone: 'warning',
      title: 'Ready with unverified checks',
      detail: `${unverified.length} check${unverified.length === 1 ? '' : 's'} will be verified when recording starts.`,
      actionItems
    }
  }
  if (actionItems.length === 0) {
    return {
      tone: 'blocked',
      title: 'Recording is not ready',
      detail: 'Finish the recording checks before starting.',
      actionItems: []
    }
  }
  return {
    tone: 'blocked',
    title: 'Recording needs attention',
    detail: `${actionItems.length} check${actionItems.length === 1 ? '' : 's'} must be resolved before recording.`,
    actionItems
  }
}
