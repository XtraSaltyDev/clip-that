export type CaptureFailureKind = 'permission' | 'protected' | 'vanished' | 'unavailable'

export function captureFailureMessage(kind: CaptureFailureKind, subject: string): string {
  switch (kind) {
    case 'permission':
      return `ClipThat does not have permission to capture ${subject}. Check the operating system privacy settings and try again.`
    case 'protected':
      return `${subject} is protected by the operating system or content provider and cannot be captured.`
    case 'vanished':
      return `${subject} is no longer available. Reopen it or choose another source.`
    default:
      return `${subject} could not be captured. Verify that it is visible and try again.`
  }
}

export function classifyCaptureFailure(message: string): CaptureFailureKind {
  if (/permission|denied|not allowed|not permitted/i.test(message)) return 'permission'
  if (/protected|drm|black frame|restricted content/i.test(message)) return 'protected'
  if (/closed|disappeared|no longer|not found|invalid source/i.test(message)) return 'vanished'
  return 'unavailable'
}
