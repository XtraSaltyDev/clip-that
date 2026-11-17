import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { LibraryCollection, LibraryCollectionInput } from '../../shared/types'
import { libraryCollectionInput } from '../ipc/validation'
import { atomicFileWrite } from './atomic-file'
import { readGuideJsonWithBackup } from './guide-files'

const MAX_COLLECTIONS = 100

function parseCollections(value: unknown): LibraryCollection[] {
  if (!Array.isArray(value) || value.length > MAX_COLLECTIONS)
    throw new TypeError('Saved collections could not be read')
  const ids = new Set<string>()
  return value.map((entry) => {
    const input = libraryCollectionInput(entry)
    if (!input.id || ids.has(input.id)) throw new TypeError('Saved collection identity is invalid')
    ids.add(input.id)
    return { ...input, id: input.id }
  })
}

/** Serializes read/modify/write operations, including simultaneous renderer requests. */
export class LibraryCollections {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly path: () => string,
    private readonly onRecovery: () => void = () => {}
  ) {}

  private async read(): Promise<LibraryCollection[]> {
    const path = this.path()
    try {
      const result = await readGuideJsonWithBackup(path, `${path}.bak`, parseCollections)
      // Repair a damaged primary from the valid backup before accepting further writes.
      if (result.recovered) {
        await atomicFileWrite(path, JSON.stringify(result.value, null, 2))
        this.onRecovery()
      }
      return result.value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // A malformed backup must be reported even when the primary is absent.
      try {
        await fs.access(`${path}.bak`)
      } catch (backupError) {
        if ((backupError as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw backupError
      }
      throw new Error('Saved collections need recovery. Their existing files have been preserved.')
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }

  list(): Promise<LibraryCollection[]> {
    return this.enqueue(() => this.read())
  }

  save(input: LibraryCollectionInput): Promise<LibraryCollection[]> {
    const safe = libraryCollectionInput(input)
    return this.enqueue(async () => {
      const current = await this.read()
      if (safe.id && !current.some((entry) => entry.id === safe.id))
        throw new Error('This collection was removed. Save the search as a new collection.')
      if (!safe.id && current.length >= MAX_COLLECTIONS)
        throw new Error('You can save up to 100 collections. Remove one before saving another.')
      if (
        current.some(
          (entry) =>
            entry.id !== safe.id && entry.name.toLocaleLowerCase() === safe.name.toLocaleLowerCase()
        )
      )
        throw new Error('A collection already uses that name. Choose another name.')
      const collection = { ...safe, id: safe.id ?? randomUUID() }
      const next = safe.id
        ? current.map((entry) => (entry.id === safe.id ? collection : entry))
        : [...current, collection]
      await this.write(current, next)
      return next
    })
  }

  remove(id: string): Promise<LibraryCollection[]> {
    return this.enqueue(async () => {
      const current = await this.read()
      const next = current.filter((entry) => entry.id !== id)
      if (next.length !== current.length) await this.write(current, next)
      return next
    })
  }

  private async write(current: LibraryCollection[], next: LibraryCollection[]): Promise<void> {
    const path = this.path()
    await atomicFileWrite(`${path}.bak`, JSON.stringify(current, null, 2))
    await atomicFileWrite(path, JSON.stringify(next, null, 2))
  }
}
