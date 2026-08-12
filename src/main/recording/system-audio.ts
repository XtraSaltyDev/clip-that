/**
 * Electron can capture desktop audio natively on Windows and Linux. On macOS,
 * Apple's public system-audio capture API is available from Ventura (13) onward.
 */
export function supportsSystemAudio(platform: NodeJS.Platform, systemVersion = ''): boolean {
  if (platform === 'win32' || platform === 'linux') return true
  if (platform !== 'darwin') return false

  const major = Number.parseInt(systemVersion.split('.')[0] ?? '', 10)
  return Number.isFinite(major) && major >= 13
}
