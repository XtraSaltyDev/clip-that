import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { nativeImage } from 'electron'
import type {
  SnagitImportPreview,
  SnagitImportProgress,
  SnagitImportSummary
} from '@shared/types'
import { ffmpegPath } from '../recording/ffmpeg'
import { library, type LibraryBatchImportEntry } from '../store/library'
import { tempDir } from '../store/paths'
import { isPathInside, isRealPathInside } from '../store/path-guard'
import {
  scanSnagitFolder,
  summarizeSnagitScan,
  hashFile,
  type SnagitFile,
  type SnagitInspection,
  type SnagitScanResult
} from './snagit-core'

interface SnagitPlan {
  id: string
  root: string
  rootName: string
  scan: SnagitScanResult
  preview: SnagitImportPreview
}

interface StagedEntry extends LibraryBatchImportEntry {
  sourcePath: string
}

const plans = new Map<string, SnagitPlan>()
const imports = new Map<string, AbortController>()

function existingHashes(): Set<string> {
  return library.contentHashes()
}

function inspectImage(filePath: string): Promise<SnagitInspection> {
  return Promise.resolve().then(() => {
    const image = nativeImage.createFromPath(filePath)
    if (image.isEmpty()) throw new Error('image could not be decoded')
    const size = image.getSize()
    return { width: size.width, height: size.height }
  })
}

function parseNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function ffprobeCandidate(): string {
  if (process.env['CLIPTHAT_FFPROBE']) return process.env['CLIPTHAT_FFPROBE']
  const ffmpeg = ffmpegPath()
  if (ffmpeg && ffmpeg !== 'ffmpeg') {
    const candidate = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    return candidate
  }
  return 'ffprobe'
}

function runProcess(command: string, args: string[], signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      resolveProcess(result)
    }
    const abort = () => child.kill('SIGTERM')
    if (signal?.aborted) {
      child.kill('SIGTERM')
    } else {
      signal?.addEventListener('abort', abort, { once: true })
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }))
  })
}

async function inspectVideo(filePath: string): Promise<SnagitInspection> {
  try {
    const result = await runProcess(ffprobeCandidate(), [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration:format=duration',
      '-of', 'json', filePath
    ])
    if (result.code === 0) {
      const parsed = JSON.parse(result.stdout) as {
        streams?: Array<{ width?: number; height?: number; duration?: number | string }>
        format?: { duration?: number | string }
      }
      const stream = parsed.streams?.[0]
      const width = parseNumber(stream?.width)
      const height = parseNumber(stream?.height)
      const durationMs = (parseNumber(stream?.duration) ?? parseNumber(parsed.format?.duration))
      if (width && height && durationMs) return { width, height, durationMs: durationMs * 1000 }
    }
  } catch {
    // Packaged builds may not include ffprobe; use the bundled ffmpeg's human output below.
  }

  const ffmpeg = ffmpegPath()
  if (!ffmpeg) throw new Error('video metadata tool is unavailable')
  const result = await runProcess(ffmpeg, ['-hide_banner', '-i', filePath, '-f', 'null', '-'])
  const stream = /Video:[^\n]*?\b(\d{1,6})x(\d{1,6})\b/.exec(result.stderr)
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(result.stderr)
  if (result.code !== 0 || !stream || !duration) throw new Error('MP4 metadata could not be read')
  const durationMs = (Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000
  return { width: Number(stream[1]), height: Number(stream[2]), durationMs }
}

async function currentSourceFile(filePath: string, root: string): Promise<boolean> {
  return isPathInside(root, resolve(filePath)) && await isRealPathInside(root, filePath)
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new SnagitImportCancelledError()
}

export class SnagitImportCancelledError extends Error {
  constructor() {
    super('Snagit import was cancelled')
  }
}

export async function scanSnagitLibrary(root: string): Promise<SnagitImportPreview> {
  const scan = await scanSnagitFolder(resolve(root), { inspectImage, inspectVideo }, existingHashes())
  const id = randomUUID()
  const summary = summarizeSnagitScan(scan)
  const preview: SnagitImportPreview = {
    planId: id,
    rootName: basename(scan.root),
    ...summary,
    limitReached: scan.limitReached
  }
  plans.set(id, { id, root: scan.root, rootName: basename(scan.root), scan, preview })
  return preview
}

function titleFor(file: SnagitFile): string {
  return file.name
}

async function stageImage(file: SnagitFile, stageRoot: string, signal: AbortSignal): Promise<StagedEntry> {
  throwIfAborted(signal)
  const image = nativeImage.createFromPath(file.sourcePath)
  if (image.isEmpty()) throw new Error('image could not be decoded during import')
  const id = randomUUID()
  const stagedPath = join(stageRoot, `${id}.png`)
  const stagedThumbnail = join(stageRoot, `${id}.thumb.png`)
  await fs.writeFile(stagedPath, image.toPNG())
  const size = image.getSize()
  const scale = Math.min(1, 480 / Math.max(size.width, size.height, 1))
  const thumb = scale < 1
    ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' })
    : image
  await fs.writeFile(stagedThumbnail, thumb.toPNG())
  return {
    sourcePath: file.sourcePath,
    stagedPath,
    stagedThumbnail,
    title: titleFor(file),
    kind: 'image',
    width: file.width!,
    height: file.height!,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    contentHash: file.contentHash!,
    importedFrom: 'snagit'
  }
}

async function stageVideo(file: SnagitFile, stageRoot: string, signal: AbortSignal): Promise<StagedEntry> {
  throwIfAborted(signal)
  const id = randomUUID()
  const stagedPath = join(stageRoot, `${id}.mp4`)
  const stagedThumbnail = join(stageRoot, `${id}.thumb.png`)
  await fs.copyFile(file.sourcePath, stagedPath)
  const ffmpeg = ffmpegPath()
  if (!ffmpeg) throw new Error('video poster tool is unavailable')
  const result = await runProcess(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', file.sourcePath,
    '-frames:v', '1', '-f', 'image2', stagedThumbnail
  ], signal)
  if (result.code !== 0) throw new Error('video poster could not be generated')
  return {
    sourcePath: file.sourcePath,
    stagedPath,
    stagedThumbnail,
    title: titleFor(file),
    kind: 'video',
    width: file.width!,
    height: file.height!,
    durationMs: file.durationMs!,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    contentHash: file.contentHash!,
    importedFrom: 'snagit'
  }
}

function progress(
  planId: string,
  state: SnagitImportProgress['state'],
  completed: number,
  total: number,
  imported: number,
  skipped: number,
  failed: number,
  currentTitle?: string
): SnagitImportProgress {
  return {
    planId,
    state,
    completed,
    total,
    imported,
    skipped,
    failed,
    percent: total ? Math.round((completed / total) * 100) : 100,
    ...(currentTitle ? { currentTitle } : {})
  }
}

export async function importSnagitLibrary(
  planId: string,
  onProgress?: (next: SnagitImportProgress) => void
): Promise<SnagitImportSummary> {
  const plan = plans.get(planId)
  if (!plan) throw new Error('Snagit import preview expired; choose the folder again')
  if (imports.has(planId)) throw new Error('Snagit import is already running')
  const controller = new AbortController()
  imports.set(planId, controller)
  const stageRoot = join(tempDir(), `snagit-import-${planId}`)
  await fs.mkdir(stageRoot, { recursive: true })
  const candidates = plan.scan.files.filter((file) => file.category === 'supported')
  const staged: StagedEntry[] = []
  let failed = 0
  try {
    let completed = 0
    onProgress?.(progress(planId, 'importing', 0, candidates.length, 0, 0, 0))
    for (const file of candidates) {
      throwIfAborted(controller.signal)
      onProgress?.(progress(planId, 'importing', completed, candidates.length, staged.length, 0, failed, file.name))
      if (!(await currentSourceFile(file.sourcePath, plan.root))) {
        failed += 1
        completed += 1
        continue
      }
      try {
        const current = await fs.stat(file.sourcePath)
        if (current.size !== file.byteSize) throw new Error('source changed after scanning')
        if (await hashFile(file.sourcePath) !== file.contentHash) throw new Error('source changed after scanning')
        const entry = file.kind === 'image'
          ? await stageImage(file, stageRoot, controller.signal)
          : await stageVideo(file, stageRoot, controller.signal)
        staged.push(entry)
      } catch (error) {
        if (error instanceof SnagitImportCancelledError) throw error
        failed += 1
      }
      completed += 1
    }
    throwIfAborted(controller.signal)
    const imported = await library.importBatch(staged, stageRoot)
    const summary: SnagitImportSummary = {
      state: 'completed',
      imported: imported.length,
      skipped: plan.preview.counts.duplicates,
      failed,
      unsupported: plan.preview.counts.unsupported,
      nativeProjects: plan.preview.counts.nativeProjects,
      unreadable: plan.preview.counts.unreadable
    }
    onProgress?.(progress(planId, 'completed', candidates.length, candidates.length, summary.imported, summary.skipped, summary.failed))
    return summary
  } catch (error) {
    if (error instanceof SnagitImportCancelledError || controller.signal.aborted) {
      onProgress?.(progress(planId, 'cancelled', 0, candidates.length, 0, plan.preview.counts.duplicates, failed))
      return {
        state: 'cancelled',
        imported: 0,
        skipped: plan.preview.counts.duplicates,
        failed,
        unsupported: plan.preview.counts.unsupported,
        nativeProjects: plan.preview.counts.nativeProjects,
        unreadable: plan.preview.counts.unreadable
      }
    }
    throw error
  } finally {
    imports.delete(planId)
    plans.delete(planId)
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => {})
  }
}

export function cancelSnagitImport(planId: string): boolean {
  const controller = imports.get(planId)
  if (!controller) return false
  controller.abort()
  return true
}

export function clearSnagitPlan(planId: string): void {
  plans.delete(planId)
}
