import { basename, dirname, extname, join } from 'node:path'

/**
 * MediaRecorder WebM often has no cues/duration, which Chromium refuses to play
 * from disk. A stream-copy remux next to the raw file is the review sibling.
 */
export function reviewPlaybackPath(rawPath: string): string {
  const extension = extname(rawPath)
  const stem = basename(rawPath, extension)
  return join(dirname(rawPath), `${stem}.play.webm`)
}

/** ffmpeg arguments that rewrite timestamps/cues without transcoding. */
export function reviewPlaybackCopyArgs(input: string, output: string): string[] {
  return [
    '-hide_banner',
    '-y',
    '-fflags',
    '+genpts',
    '-i',
    input,
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    output
  ]
}
