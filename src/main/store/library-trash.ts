import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import type { LibraryItem } from '@shared/types'
import { isPathInside, isRealPathInside } from './path-guard'

export function isTrashed(item: LibraryItem): boolean {
  return item.deletedAt !== undefined
}

/** Index transactions keep originals and metadata together, including across restarts. */
export class LibraryTrash {
  private purging = false

  constructor(
    private readonly read: () => LibraryItem[],
    private readonly commit: (items: LibraryItem[]) => void,
    private readonly roots: {
      captures: string
      recordings: string
      projects: string
      thumbs: string
    }
  ) {}

  move(ids: readonly string[]): void {
    this.assertIdle()
    const selected = new Set(ids)
    const now = Date.now()
    this.commit(
      this.read().map((item) =>
        selected.has(item.id) && !isTrashed(item) ? { ...item, deletedAt: now } : item
      )
    )
  }

  restore(ids: readonly string[]): void {
    this.assertIdle()
    const selected = new Set(ids)
    this.commit(
      this.read().map((item) => {
        if (!selected.has(item.id) || !isTrashed(item)) return item
        const restored = { ...item }
        delete restored.deletedAt
        return restored
      })
    )
  }

  async purge(ids: readonly string[]): Promise<void> {
    this.assertIdle()
    this.purging = true
    try {
      const selected = new Set(ids)
      const items = this.read()
      const removed = items.filter((item) => selected.has(item.id))
      if (removed.some((item) => !isTrashed(item)))
        throw new Error('Only items in Trash can be permanently deleted.')

      const retainedPaths = new Set(
        items
          .filter((item) => !selected.has(item.id))
          .flatMap((item) =>
            [item.filePath, item.projectPath, item.thumbnail, item.exportPath]
              .filter((path): path is string => Boolean(path))
              .map((path) => resolve(path))
          )
      )
      const paths = new Set<string>()
      // Preflight the whole batch before removing any bytes. External exports are never targets.
      for (const item of removed) {
        for (const [root, path] of [
          [item.kind === 'image' ? this.roots.captures : this.roots.recordings, item.filePath],
          [this.roots.projects, item.projectPath],
          [this.roots.thumbs, item.thumbnail]
        ]) {
          if (!path) continue
          if (!isPathInside(root!, path) || resolve(root!) === resolve(path))
            throw new Error('A Trash file is outside its Library folder. No files were deleted.')
          if (retainedPaths.has(resolve(path))) continue
          const stat = await fs.lstat(path).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
          })
          if (!stat) continue // A previous interrupted purge can be retried.
          if (!stat.isFile() || !(await isRealPathInside(root!, path)))
            throw new Error('A Trash file is not a regular Library file. No files were deleted.')
          paths.add(path)
        }
      }
      // Leave the tombstones indexed until every delete succeeds. Startup reconciliation
      // must never recover a partially deleted item into the active Library.
      for (const path of paths) await fs.rm(path, { force: true })
      // Other captures may arrive while filesystem operations are pending.
      this.commit(this.read().filter((item) => !selected.has(item.id)))
    } catch (error) {
      throw new Error(
        `Could not permanently delete the selection. Items remain in Trash; retry to finish. ${(error as Error).message}`
      )
    } finally {
      this.purging = false
    }
  }

  private assertIdle(): void {
    if (this.purging) throw new Error('Trash is being emptied. Wait for deletion to finish.')
  }
}
