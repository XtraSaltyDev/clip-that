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
  onProgress?: (p: FfmpegProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const bin = ffmpegPath()
  if (!bin) return Promise.reject(new Error('ffmpeg is unavailable'))

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stderr = ''
    let settled = false
    let cancelled = signal?.aborted ?? false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      error ? reject(error) : resolve()
    }
    const abort = () => {
      cancelled = true
      child.kill('SIGTERM')
    }
    if (cancelled) child.kill('SIGTERM')
    else signal?.addEventListener('abort', abort, { once: true })

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

    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (cancelled) finish(new FfmpegCancelledError())
      else if (code === 0) finish()
      else finish(new Error(`ffmpeg exited with ${code}\n${stderr.slice(-1500)}`))
    })
  })
}

export class FfmpegCancelledError extends Error {
  constructor() {
    super('Video export was cancelled')
  }
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

const VIDEOTOOLBOX_QUALITY: Record<VideoExportOptions['quality'], string> = {
  low: '35',
  medium: '50',
  high: '65'
}

let encodersPromise: Promise<Set<string>> | null = null
const failedHardwareEncoders = new Set<string>()

function availableEncoders(): Promise<Set<string>> {
  if (encodersPromise) return encodersPromise
  const bin = ffmpegPath()
  if (!bin) return Promise.resolve(new Set())
  encodersPromise = new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-encoders'], { windowsHide: true })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.on('error', () => resolve(new Set()))
    child.on('close', () => {
      const names = new Set<string>()
      for (const match of output.matchAll(/^\s*V\S*\s+(\S+)/gm)) names.add(match[1])
      resolve(names)
    })
  })
  return encodersPromise
}

interface HardwareEncoder {
  name: string
  args: string[]
}

function hardwareH264Candidates(quality: VideoExportOptions['quality']): HardwareEncoder[] {
  if (process.platform === 'darwin') {
    return [{
      name: 'h264_videotoolbox',
      args: [
        '-c:v', 'h264_videotoolbox',
        '-q:v', VIDEOTOOLBOX_QUALITY[quality],
        '-allow_sw', '0',
        '-profile:v', 'high'
      ]
    }]
  }
  if (process.platform === 'win32') {
    const qp = CRF[quality]
    // The bundled Windows FFmpeg advertises all three vendor encoders. A candidate can
    // still fail when its matching GPU is absent, so failures are remembered and the next
    // encoder (ultimately libx264) is tried without changing the user's export settings.
    return [
      {
        name: 'h264_nvenc',
        args: ['-c:v', 'h264_nvenc', '-preset', 'medium', '-rc', 'vbr_hq', '-cq', qp, '-b:v', '0']
      },
      {
        name: 'h264_qsv',
        args: ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', qp]
      },
      {
        name: 'h264_amf',
        args: [
          '-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp',
          '-qp_i', qp, '-qp_p', qp, '-qp_b', qp
        ]
      }
    ]
  }
  return []
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
  onProgress?: (p: FfmpegProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  const filters = ['format=yuv420p']
  const scale = scaleFilter(opts.maxWidth)
  if (scale) filters.unshift(scale)

  const beforeCodec = [
    '-y',
    ...trimArgs(opts),
    '-i',
    input,
    '-vf',
    filters.join(','),
  ]
  const afterCodec = [
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    ...(opts.fps ? ['-r', String(opts.fps)] : []),
    output
  ]

  const available = await availableEncoders()
  for (const encoder of hardwareH264Candidates(opts.quality)) {
    if (!available.has(encoder.name) || failedHardwareEncoders.has(encoder.name)) continue
    try {
      await runFfmpeg([...beforeCodec, ...encoder.args, ...afterCodec], totalMs, onProgress, signal)
      console.log(`[ffmpeg] MP4 encoded with ${encoder.name}`)
      return output
    } catch (err) {
      if (err instanceof FfmpegCancelledError) throw err
      failedHardwareEncoders.add(encoder.name)
      console.warn(`[ffmpeg] ${encoder.name} unavailable; falling back`, (err as Error).message)
    }
  }

  await runFfmpeg(
    [
      ...beforeCodec,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', CRF[opts.quality],
      ...afterCodec
    ],
    totalMs,
    onProgress,
    signal
  )
  return output
}

/** Two-pass palette GIF — the only way to get a GIF that doesn't look like 1998. */
export async function toGif(
  input: string,
  output: string,
  opts: VideoExportOptions,
  totalMs: number,
  onProgress?: (p: FfmpegProgress) => void,
  signal?: AbortSignal
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
      onProgress,
      signal
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
      onProgress,
      signal
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
  onProgress?: (p: FfmpegProgress) => void,
  signal?: AbortSignal
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
  await runFfmpeg(args, totalMs, onProgress, signal)
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
