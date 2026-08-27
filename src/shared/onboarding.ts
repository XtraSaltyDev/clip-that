/**
 * First-run capture buttons are only safe once macOS has actually granted
 * Screen Recording. Other platforms do not use that permission prompt.
 */
export function welcomeCaptureReady(
  platform: string,
  screenVerified: boolean | undefined
): boolean {
  if (platform !== 'darwin') return true
  return screenVerified === true
}
