export interface ByteRange {
  start: number
  end: number
}

/** Parse one RFC 7233 byte range. Multiple ranges are intentionally unsupported. */
export function parseByteRange(header: string | null, size: number): ByteRange | null | 'invalid' {
  if (!header) return null
  if (!Number.isSafeInteger(size) || size <= 0) return 'invalid'
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2])) return 'invalid'

  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return 'invalid'
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}
