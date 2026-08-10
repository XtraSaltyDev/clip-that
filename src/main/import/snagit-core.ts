import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname, relative, resolve, sep } from 'node:path'
import type { SnagitImportCategory } from '@shared/types'

export const SNAGIT_MAX_FILES = 10_000
export const SNAGIT_MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024
export const SNAGIT_MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024
export const SNAGIT_SAMPLE_LIMIT = 8

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const VIDEO_EXTENSIONS = new Set(['.mp4'])
const NATIVE_EXTENSIONS = new Set(['.snagx', '.snag', '.snagarchive'])

export interface SnagitInspection {
  width: number
  height: number
  durationMs?: number
}

export interface SnagitFile {
  sourcePath: string
  name: string
  extension: string
  category: SnagitImportCategory
  kind?: 'image' | 'video'
  byteSize: number
  contentHash?: string
  width?: number
  height?: number
  durationMs?: number
  createdAt: number
  updatedAt: number
  reason?: string
}

export interface SnagitScanResult {
  root: string
  files: SnagitFile[]
  limitReached?: string
}

export interface SnagitScanDependencies {
  inspectImage: (filePath: string) => Promise<SnagitInspection>
  inspectVideo: (filePath: string) => Promise<SnagitInspection>
}

export function classifySnagitExtension(extension: string): {
  category: SnagitImportCategory | 'candidate'
  kind?: 'image' | 'video'
} {
  const normalized = extension.toLowerCase()
  if (IMAGE_EXTENSIONS.has(normalized)) return { category: 'candidate', kind: 'image' }
  if (VIDEO_EXTENSIONS.has(normalized)) return { category: 'candidate', kind: 'video' }
  if (NATIVE_EXTENSIONS.has(normalized)) return { category: 'nativeProjects' }
  return { category: 'unsupported' }
}

function inside(root: string, candidate: string): boolean {
  const rootResolved = resolve(root)
  const relativePath = relative(rootResolved, resolve(candidate))
  return relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !relativePath.startsWith(sep))
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let bytesRead = 0
    do {
      const read = await handle.read(buffer, 0, buffer.length, bytesRead)
      if (read.bytesRead === 0) break
      hash.update(buffer.subarray(0, read.bytesRead))
      bytesRead += read.bytesRead
    } while (true)
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

function timestamps(stat: { birthtimeMs: number; mtimeMs: number }): { createdAt: number; updatedAt: number } {
  const createdAt = Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0
    ? stat.birthtimeMs
    : stat.mtimeMs
  return {
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    updatedAt: Number.isFinite(stat.mtimeMs) && stat.mtimeMs > 0 ? stat.mtimeMs : createdAt
  }
}

function basicFile(
  filePath: string,
  category: SnagitImportCategory,
  stat: { size: number; birthtimeMs: number; mtimeMs: number },
  reason?: string
): SnagitFile {
  const extension = extname(filePath).toLowerCase()
  return {
    sourcePath: filePath,
    name: basename(filePath),
    extension,
    category,
    byteSize: stat.size,
    ...timestamps(stat),
    ...(reason ? { reason } : {})
  }
}

/**
 * Recursively scan one already-selected root. Symlinks are deliberately skipped before
 * stat/realpath so a cloud folder cannot smuggle files outside the selected tree.
 */
export async function scanSnagitFolder(
  selectedRoot: string,
  deps: SnagitScanDependencies,
  existingHashes: ReadonlySet<string> = new Set()
): Promise<SnagitScanResult> {
  const root = resolve(selectedRoot)
  const rootStat = await fs.lstat(root)
  if (!rootStat.isDirectory()) throw new Error('Snagit import source is not a folder')
  const rootReal = await fs.realpath(root)
  const files: SnagitFile[] = []
  const seenHashes = new Set(existingHashes)
  let totalBytes = 0
  let limitReached: string | undefined

  const visit = async (directory: string): Promise<void> => {
    if (limitReached) return
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (limitReached) return
      const filePath = resolve(directory, entry.name)
      if (!inside(root, filePath)) continue

      // Do not follow either symlinked directories or files.
      if (entry.isSymbolicLink()) {
        files.push(basicFile(filePath, 'unsupported', { size: 0, birthtimeMs: 0, mtimeMs: 0 }, 'symlink skipped'))
        continue
      }
      if (entry.isDirectory()) {
        if (classifySnagitExtension(extname(entry.name)).category === 'nativeProjects') {
          const stat = await fs.stat(filePath).catch(() => null)
          files.push(basicFile(filePath, 'nativeProjects', stat ?? { size: 0, birthtimeMs: 0, mtimeMs: 0 }))
          continue
        }
        const realDirectory = await fs.realpath(filePath).catch(() => null)
        if (!realDirectory || !inside(rootReal, realDirectory)) {
          files.push(basicFile(filePath, 'unsupported', { size: 0, birthtimeMs: 0, mtimeMs: 0 }, 'linked folder skipped'))
          continue
        }
        await visit(filePath)
        continue
      }
      if (!entry.isFile()) continue

      if (files.length >= SNAGIT_MAX_FILES) {
        limitReached = `Scan stopped after ${SNAGIT_MAX_FILES.toLocaleString()} files`
        return
      }

      const kind = classifySnagitExtension(extname(entry.name))
      const stat = await fs.stat(filePath).catch(() => null)
      if (!stat?.isFile()) {
        files.push(basicFile(filePath, 'unreadable', { size: 0, birthtimeMs: 0, mtimeMs: 0 }, 'file could not be read'))
        continue
      }
      totalBytes += stat.size
      if (totalBytes > SNAGIT_MAX_TOTAL_BYTES) {
        limitReached = `Scan stopped after ${SNAGIT_MAX_TOTAL_BYTES / (1024 * 1024 * 1024)} GB`
        return
      }

      if (stat.size > SNAGIT_MAX_FILE_BYTES) {
        files.push(basicFile(filePath, 'unreadable', stat, 'file is larger than the supported limit'))
        continue
      }
      if (kind.category !== 'candidate') {
        files.push(basicFile(filePath, kind.category, stat))
        continue
      }

      const candidate = basicFile(filePath, 'supported', stat)
      candidate.kind = kind.kind
      try {
        const inspected = kind.kind === 'image'
          ? await deps.inspectImage(filePath)
          : await deps.inspectVideo(filePath)
        if (
          !Number.isFinite(inspected.width) || inspected.width < 1 || inspected.width > 200_000 ||
          !Number.isFinite(inspected.height) || inspected.height < 1 || inspected.height > 200_000 ||
          (kind.kind === 'video' &&
            (!Number.isFinite(inspected.durationMs) || (inspected.durationMs ?? 0) <= 0 || (inspected.durationMs ?? 0) > 86_400_000))
        ) {
          throw new Error('media metadata is invalid')
        }
        candidate.width = inspected.width
        candidate.height = inspected.height
        candidate.durationMs = inspected.durationMs
        candidate.contentHash = await hashFile(filePath)
        if (seenHashes.has(`${kind.kind}:${candidate.contentHash}`)) {
          candidate.category = 'duplicates'
        } else {
          seenHashes.add(`${kind.kind}:${candidate.contentHash}`)
        }
      } catch (error) {
        candidate.category = 'unreadable'
        candidate.reason = (error as Error).message.slice(0, 240)
        delete candidate.contentHash
      }
      files.push(candidate)
    }
  }

  await visit(root)
  return { root, files, limitReached }
}

export function summarizeSnagitScan(scan: SnagitScanResult): {
  counts: Record<SnagitImportCategory, number>
  bytes: Record<SnagitImportCategory, number>
  totalFiles: number
  totalBytes: number
  importableFiles: number
  importableBytes: number
  samples: Record<SnagitImportCategory, string[]>
} {
  const categories: SnagitImportCategory[] = ['supported', 'duplicates', 'nativeProjects', 'unsupported', 'unreadable']
  const counts = Object.fromEntries(categories.map((category) => [category, 0])) as Record<SnagitImportCategory, number>
  const bytes = Object.fromEntries(categories.map((category) => [category, 0])) as Record<SnagitImportCategory, number>
  const samples = Object.fromEntries(categories.map((category) => [category, []])) as unknown as Record<SnagitImportCategory, string[]>
  for (const file of scan.files) {
    counts[file.category] += 1
    bytes[file.category] += file.byteSize
    if (samples[file.category].length < SNAGIT_SAMPLE_LIMIT) samples[file.category].push(file.name)
  }
  return {
    counts,
    bytes,
    totalFiles: scan.files.length,
    totalBytes: scan.files.reduce((total, file) => total + file.byteSize, 0),
    importableFiles: counts.supported,
    importableBytes: bytes.supported,
    samples
  }
}
