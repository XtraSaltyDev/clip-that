/** Accept seconds, M:SS or H:MM:SS, with up to three decimal places on seconds. */
export function parseTimecode(value: string): number | null {
  const parts = value.trim().split(':')
  if (parts.length < 1 || parts.length > 3) return null
  const last = parts.at(-1)!
  if (!/^\d+(?:\.\d{1,3})?$/.test(last) || parts.slice(0, -1).some((part) => !/^\d+$/.test(part)))
    return null
  const seconds = Number(last)
  const minutes = parts.length >= 2 ? Number(parts.at(-2)) : 0
  const hours = parts.length === 3 ? Number(parts[0]) : 0
  if ((parts.length > 1 && seconds >= 60) || (parts.length === 3 && minutes >= 60)) return null
  const milliseconds = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000)
  return Number.isSafeInteger(milliseconds) ? milliseconds : null
}

export function formatTimecode(ms: number): string {
  const tenths = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 100))
  const hours = Math.floor(tenths / 36_000)
  const minutes = Math.floor((tenths % 36_000) / 600)
  const seconds = Math.floor((tenths % 600) / 10)
  const decimal = tenths % 10
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${decimal}`
}
