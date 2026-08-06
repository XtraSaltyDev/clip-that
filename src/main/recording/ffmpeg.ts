import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { VideoExportOptions } from '@shared/types'
import { tempDir } from '../store/paths'

/**
 * Resolve the bundled ffmpeg. `@ffmpeg-installer` reports a path inside `app.asar`,
 * which isn't executable — electron-builder unpacks it, so rewrite to `app.asar.unpacked`.
 */
function resolveFfmpeg(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const installer = require('@ffmpeg-installer/ffmpeg') as { path: string }
    let p = installer.path
    if (app.isPackaged) p = p.replace('app.asar', 'app.asar.unpacked')
    if (existsSync(p)) return p
  } catch {
    /* fall through */
  }
  // Last resort: whatever is on PATH.
  return 'ffmpeg'
}

let cachedPath: string | null | undefined

export function ffmpegPath(): string | null {
  if (cachedPath === undefined) cachedPath = resolveFfmpeg()
  return cachedPath
}

export interface FfmpegProgress {
  percent: number
  timeMs: number
}

function parseTime(value: string): number {
  const [h, m, s] = value.split(':')
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000
}

function runFfmpeg(
  args: string[],
  totalMs: number,
  onProgress?: (p: FfmpegProgress) => void
): Promise<void> {
  const bin = ffmpegPath()
  if (!bin) return Promise.reject(new Error('ffmpeg is unavailable'))

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stderr = ''

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000)
      const match = /time=(\d+:\d+:\d+\.\d+)/.exec(text)
      if (match && onProgress) {
        const timeMs = parseTime(match[1])
        onProgress({
          percent: totalMs > 0 ? Math.min(99, Math.round((timeMs / totalMs) * 100)) : 0,
          timeMs
        })
      }
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with ${code}\n${stderr.slice(-1500)}`))
    })
  })
}

const CRF: Record<VideoExportOptions['quality'], string> = {
  low: '30',
  medium: '24',
  high: '18'
}

const GIF_COLORS: Record<VideoExportOptions['quality'], string> = {
  low: '64',
  medium: '128',
  high: '256'
}

function trimArgs(opts: VideoExportOptions): string[] {
  const args: string[] = []
  if (opts.startMs && opts.startMs > 0) args.push('-ss', (opts.startMs / 1000).toFixed(3))
  if (opts.endMs && opts.endMs > (opts.startMs ?? 0)) {
    args.push('-to', (opts.endMs / 1000).toFixed(3))
  }
  return args
}

function scaleFilter(maxWidth?: number): string | null {
  if (!maxWidth) return null
  // -2 keeps the aspect ratio and forces an even height, which h264 requires.
  return `scale='min(${maxWidth},iw)':-2:flags=lanczos`
}

/** Transcode the recorder's WebM into MP4 (H.264 + AAC) for universal playback. */
export async function toMp4(
  input: string,
  output: string,
  opts: VideoExportOptions,
  totalMs: number,
  onProgress?: (p: FfmpegProgress) => void
): Promise<string> {
  const filters = ['format=yuv420p']
  const scale = scaleFilter(opts.maxWidth)
  if (scale) filters.unshift(scale)

  const args = [
    '-y',
    ...trimArgs(opts),
    '-i',
    input,
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    CRF[opts.quality],
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    ...(opts.fps ? ['-r', String(opts.fps)] : []),
    output
  ]
  await runFfmpeg(args, totalMs, onProgress)
  return output
}

/** Two-pass palette GIF — the only way to get a GIF that doesn't look like 1998. */
export async function toGif(
  input: string,
  output: string,
  opts: VideoExportOptions,
  totalMs: number,
  onProgress?: (p: FfmpegProgress) => void
): Promise<string> {
  const fps = opts.fps ?? 15
  const scale = scaleFilter(opts.maxWidth ?? 900) ?? 'scale=iw:ih'
  const palette = join(tempDir(), `palette-${Date.now()}.png`)

  try {
    await runFfmpeg(
      [
        '-y',
        ...trimArgs(opts),
        '-i',
        input,
        '-vf',
        `fps=${fps},${scale},palettegen=max_colors=${GIF_COLORS[opts.quality]}:stats_mode=diff`,
        palette
      ],
      totalMs,
      onProgress
    )

    await runFfmpeg(
      [
        '-y',
        ...trimArgs(opts),
        '-i',
        input,
        '-i',
        palette,
        '-lavfi',
        `fps=${fps},${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
        '-loop',
        '0',
        output
      ],
      totalMs,
      onProgress
    )
    return output
  } finally {
    await fs.rm(palette, { force: true }).catch(() => {})
  }
}

/** Remux/trim WebM without re-encoding when nothing else changes. */
export async function toWebm(
  input: string,
  output: string,
  opts: VideoExportOptions,
  totalMs: number,
  onProgress?: (p: FfmpegProgress) => void
): Promise<string> {
  const needsReencode = Boolean(opts.maxWidth || opts.fps)
  const args = needsReencode
    ? [
        '-y',
        ...trimArgs(opts),
        '-i',
        input,
        ...(opts.maxWidth ? ['-vf', scaleFilter(opts.maxWidth)!] : []),
        ...(opts.fps ? ['-r', String(opts.fps)] : []),
        '-c:v',
        'libvpx-vp9',
        '-crf',
        CRF[opts.quality],
        '-b:v',
        '0',
        '-c:a',
        'libopus',
        output
      ]
    : ['-y', ...trimArgs(opts), '-i', input, '-c', 'copy', output]
  await runFfmpeg(args, totalMs, onProgress)
  return output
}

export async function ffmpegAvailable(): Promise<boolean> {
  const bin = ffmpegPath()
  if (!bin) return false
  return new Promise((resolve) => {
    const child = spawn(bin, ['-version'], { windowsHide: true })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}
