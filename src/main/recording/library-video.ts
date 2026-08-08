import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { LibraryItem, VideoExportOptions } from '@shared/types'
import { recordingsDir } from '../store/paths'
import { library } from '../store/library'
import { toMp4, toWebm, type FfmpegProgress } from './ffmpeg'

/** Create a non-destructive edited copy of an existing Library recording. */
export async function exportLibraryVideo(
  id: string,
  opts: VideoExportOptions,
  posterDataUrl?: string,
  onProgress?: (progress: FfmpegProgress) => void
): Promise<LibraryItem> {
  const source = library.get(id)
  if (!source || source.kind !== 'video') throw new Error('Recording was not found')
  if (opts.format === 'gif') throw new TypeError('The video editor exports MP4 or WebM')

  const durationMs = Math.max(
    1,
    (opts.endMs ?? source.durationMs ?? 1) - (opts.startMs ?? 0)
  )
  const output = join(recordingsDir(), `.editing-${randomUUID()}.${opts.format}`)
  let saved = false
  try {
    if (opts.format === 'mp4') {
      await toMp4(source.filePath, output, opts, durationMs, onProgress)
    } else {
      await toWebm(source.filePath, output, opts, durationMs, onProgress)
    }

    const item = await library.addVideo({
      filePath: output,
      title: `${source.title} — Edit`,
      width: source.width,
      height: source.height,
      durationMs,
      posterDataUrl
    })
    saved = true
    return item
  } finally {
    if (!saved) await fs.rm(output, { force: true }).catch(() => {})
  }
}
