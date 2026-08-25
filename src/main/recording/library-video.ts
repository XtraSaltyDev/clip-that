import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { LibraryItem, VideoExportOptions } from '@shared/types'
import { recordingsDir } from '../store/paths'
import { library } from '../store/library'
import { probeVideoMetadata, toMp4, toWebm, type FfmpegProgress } from './ffmpeg'

/** Create a non-destructive edited copy of an existing Library recording. */
export async function exportLibraryVideo(
  id: string,
  opts: VideoExportOptions,
  posterDataUrl?: string,
  onProgress?: (progress: FfmpegProgress) => void,
  signal?: AbortSignal
): Promise<LibraryItem> {
  const source = library.get(id)
  if (!source || source.kind !== 'video') throw new Error('Recording was not found')
  if (opts.format === 'gif') throw new TypeError('The video editor exports MP4 or WebM')

  const durationMs = Math.max(1, (opts.endMs ?? source.durationMs ?? 1) - (opts.startMs ?? 0))
  const output = join(recordingsDir(), `.editing-${randomUUID()}.${opts.format}`)
  let saved = false
  try {
    if (opts.format === 'mp4') {
      await toMp4(source.filePath, output, opts, durationMs, onProgress, signal)
    } else {
      await toWebm(source.filePath, output, opts, durationMs, onProgress, signal)
    }

    const rendered = await probeVideoMetadata(output).catch(() => null)
    const item = await library.addVideo({
      filePath: output,
      title: `${source.title} — Edit`,
      width: rendered?.width ?? source.width,
      height: rendered?.height ?? source.height,
      durationMs: rendered?.durationMs ?? durationMs,
      posterDataUrl,
      sourceId: source.id,
      derivedAspect: opts.aspect,
      derivedExportPreset: opts.exportPreset
    })
    saved = true
    return item
  } finally {
    if (!saved) await fs.rm(output, { force: true }).catch(() => {})
  }
}
