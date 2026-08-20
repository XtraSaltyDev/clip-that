export type FfmpegFailureKind =
  'cancelled' | 'space' | 'permission' | 'encoder' | 'input' | 'unknown'

export function ffmpegFailureKind(message: string): FfmpegFailureKind {
  if (/cancelled|canceled|aborted/i.test(message)) return 'cancelled'
  if (/no space left|disk full|not enough space/i.test(message)) return 'space'
  if (/permission denied|access is denied|operation not permitted/i.test(message))
    return 'permission'
  if (/unknown encoder|encoder .* not found|no compatible h\.264/i.test(message)) return 'encoder'
  if (/invalid data|could not find codec parameters|moov atom not found|end of file/i.test(message))
    return 'input'
  return 'unknown'
}

export function classifyFfmpegError(message: string): string {
  switch (ffmpegFailureKind(message)) {
    case 'cancelled':
      return 'Video export was cancelled. The raw recording was preserved.'
    case 'space':
      return 'The destination does not have enough free space. The raw recording was preserved.'
    case 'permission':
      return 'ClipThat cannot write the exported file at the selected destination. The raw recording was preserved.'
    case 'encoder':
      return 'The bundled FFmpeg package is missing the encoder required for this format. The raw recording was preserved.'
    case 'input':
      return 'The recoverable recording data is incomplete or unreadable. The raw recording was preserved.'
    default:
      return `The bundled FFmpeg export failed. The raw recording was preserved. ${message.slice(-500)}`
  }
}
