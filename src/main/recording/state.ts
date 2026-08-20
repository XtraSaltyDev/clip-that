import type { RecordingState } from '@shared/types'

const ALLOWED: Record<RecordingState, readonly RecordingState[]> = {
  idle: ['countdown', 'encoding'],
  countdown: ['recording', 'encoding', 'idle'],
  recording: ['paused', 'encoding', 'idle'],
  paused: ['recording', 'encoding', 'idle'],
  encoding: ['idle']
}

export function recordingTransitionAllowed(from: RecordingState, to: RecordingState): boolean {
  return from === to || ALLOWED[from].includes(to)
}
