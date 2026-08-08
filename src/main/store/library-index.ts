import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { promises as fs } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import type { LibraryItem } from '@shared/types'

export interface LibraryIndexLoadResult {
  items: LibraryItem[]
  source: 'primary' | 'backup' | 'empty'
  needsRepair: boolean
  warning?: string
  detail?: string
}

export interface DiscoveredLibraryFile {
  filePath: string
  kind: LibraryItem['kind']
}

/** Enumerate supported assets that are present on disk but absent from the index. */
export async function discoverLibraryFiles(
  captureRoot: string,
  recordingRoot: string,
  referencedPaths: Iterable<string>
): Promise<DiscoveredLibraryFile[]> {
  const referenced = new Set([...referencedPaths].map((path) => resolve(path)))
  const roots: Array<{
    root: string
    kind: LibraryItem['kind']
    extensions: ReadonlySet<string>
  }> = [
    { root: captureRoot, kind: 'image', extensions: new Set(['.png', '.jpg', '.jpeg', '.webp']) },
    { root: recordingRoot, kind: 'video', extensions: new Set(['.mp4', '.webm', '.gif']) }
  ]
  const discovered: DiscoveredLibraryFile[] = []
  for (const { root, kind, extensions } of roots) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !extensions.has(extname(entry.name).toLowerCase())) continue
      const filePath = join(root, entry.name)
      if (referenced.has(resolve(filePath))) continue
      discovered.push({ filePath, kind })
    }
  }
  return discovered.sort((a, b) => a.filePath.localeCompare(b.filePath))
}

function isLibraryItem(value: unknown): value is LibraryItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.title === 'string' &&
    typeof item.createdAt === 'number' &&
    Number.isFinite(item.createdAt) &&
    typeof item.updatedAt === 'number' &&
    Number.isFinite(item.updatedAt) &&
    (item.kind === 'image' || item.kind === 'video') &&
    typeof item.width === 'number' &&
    Number.isFinite(item.width) &&
    typeof item.height === 'number' &&
    Number.isFinite(item.height) &&
    typeof item.filePath === 'string' &&
    typeof item.thumbnail === 'string' &&
    Array.isArray(item.tags) &&
    item.tags.every((tag) => typeof tag === 'string') &&
    typeof item.favorite === 'boolean' &&
    typeof item.byteSize === 'number' &&
    Number.isFinite(item.byteSize) &&
    (item.projectPath === undefined || typeof item.projectPath === 'string') &&
    (item.ocrText === undefined || typeof item.ocrText === 'string') &&
    (item.durationMs === undefined ||
      (typeof item.durationMs === 'number' && Number.isFinite(item.durationMs))) &&
    (item.videoEdit === undefined || isVideoEditDraft(item.videoEdit))
  )
}

function isVideoEditDraft(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const draft = value as Record<string, unknown>
  return (
    typeof draft.startMs === 'number' && Number.isFinite(draft.startMs) && draft.startMs >= 0 &&
    typeof draft.endMs === 'number' && Number.isFinite(draft.endMs) && draft.endMs > draft.startMs &&
    (draft.format === 'mp4' || draft.format === 'webm') &&
    (draft.quality === 'medium' || draft.quality === 'high') &&
    typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt)
  )
}

function parseIndex(path: string): { items: LibraryItem[]; rejected: number } {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!Array.isArray(parsed)) throw new Error('index root is not an array')
  const items = parsed.filter(isLibraryItem)
  return { items, rejected: parsed.length - items.length }
}

/** Load the primary index, falling back to the last known-good backup without hiding damage. */
export function loadLibraryIndex(primary: string, backup: string): LibraryIndexLoadResult {
  if (!existsSync(primary)) {
    if (!existsSync(backup)) return { items: [], source: 'empty', needsRepair: false }
    try {
      const result = parseIndex(backup)
      return {
        items: result.items,
        source: 'backup',
        needsRepair: true,
        warning: 'The Library index was restored from its backup',
        detail: 'The primary Library index was missing'
      }
    } catch (backupError) {
      return {
        items: [],
        source: 'empty',
        needsRepair: true,
        warning: 'The Library index could not be read',
        detail: `Primary: missing; backup: ${(backupError as Error).message}`
      }
    }
  }

  try {
    const result = parseIndex(primary)
    return {
      items: result.items,
      source: 'primary',
      needsRepair: result.rejected > 0,
      warning: result.rejected > 0 ? 'Some invalid Library records were skipped' : undefined,
      detail: result.rejected > 0 ? `${result.rejected} invalid record(s)` : undefined
    }
  } catch (primaryError) {
    try {
      const result = parseIndex(backup)
      return {
        items: result.items,
        source: 'backup',
        needsRepair: true,
        warning: 'The Library index was restored from its backup',
        detail: (primaryError as Error).message
      }
    } catch (backupError) {
      return {
        items: [],
        source: 'empty',
        needsRepair: true,
        warning: 'The Library index could not be read',
        detail: `Primary: ${(primaryError as Error).message}; backup: ${(backupError as Error).message}`
      }
    }
  }
}

function validIndexText(path: string): string | null {
  try {
    const text = readFileSync(path, 'utf8')
    const parsed = parseIndex(path)
    return parsed.rejected === 0 ? text : null
  } catch {
    return null
  }
}

/** Replace the index atomically and retain the previous valid generation as a backup. */
export function persistLibraryIndex(
  primary: string,
  backup: string,
  items: LibraryItem[]
): void {
  const serialized = `${JSON.stringify(items, null, 2)}\n`
  const primaryTmp = `${primary}.tmp`
  const backupTmp = `${backup}.tmp`
  const previous = validIndexText(primary)
  const existingBackup = validIndexText(backup)

  try {
    // Refuse to replace the primary until a known-good backup generation exists.
    if (previous !== null) {
      writeFileSync(backupTmp, previous, 'utf8')
      renameSync(backupTmp, backup)
    } else if (existingBackup === null) {
      writeFileSync(backupTmp, serialized, 'utf8')
      renameSync(backupTmp, backup)
    }

    writeFileSync(primaryTmp, serialized, 'utf8')
    renameSync(primaryTmp, primary)
  } catch (error) {
    try {
      rmSync(primaryTmp, { force: true })
    } catch {}
    try {
      rmSync(backupTmp, { force: true })
    } catch {}
    throw new Error(`Library index write failed: ${(error as Error).message}`)
  }
}
