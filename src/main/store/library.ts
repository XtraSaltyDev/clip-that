import { EventEmitter } from 'node:events'
import { promises as fs, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { nativeImage } from 'electron'
import type { ClipDocument, LibraryItem, LibraryQuery } from '@shared/types'
import { capturesDir, libraryIndexFile, projectsDir, recordingsDir, thumbsDir } from './paths'

const THUMB_MAX = 480

interface AddImageInput {
  dataUrl: string
  title: string
  width: number
  height: number
  project?: ClipDocument
  ocrText?: string
  /** When set, the file already exists on disk and we just index it. */
  existingPath?: string
}

interface AddVideoInput {
  filePath: string
  title: string
  width: number
  height: number
  durationMs: number
  posterDataUrl?: string
}

class LibraryStore extends EventEmitter {
  private items: LibraryItem[] | null = null

  private load(): LibraryItem[] {
    if (this.items) return this.items
    try {
      const raw = JSON.parse(readFileSync(libraryIndexFile(), 'utf8'))
      this.items = Array.isArray(raw) ? (raw as LibraryItem[]) : []
    } catch {
      this.items = []
    }
    return this.items
  }

  private persist(): void {
    const target = libraryIndexFile()
    const tmp = `${target}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(this.load(), null, 2), 'utf8')
      renameSync(tmp, target)
    } catch (err) {
      console.error('[library] index write failed', err)
    }
    this.emit('changed')
  }

  list(query: LibraryQuery = {}): LibraryItem[] {
    let items = [...this.load()].sort((a, b) => b.createdAt - a.createdAt)

    if (query.kind) items = items.filter((i) => i.kind === query.kind)
    if (query.favorite) items = items.filter((i) => i.favorite)
    if (query.tag) items = items.filter((i) => i.tags.includes(query.tag!))

    if (query.search?.trim()) {
      // Every term must appear somewhere in the title, tags or OCR'd text.
      const terms = query.search.toLowerCase().split(/\s+/).filter(Boolean)
      items = items.filter((i) => {
        const haystack = `${i.title} ${i.tags.join(' ')} ${i.ocrText ?? ''}`.toLowerCase()
        return terms.every((t) => haystack.includes(t))
      })
    }

    const offset = query.offset ?? 0
    const limit = query.limit ?? 500
    return items.slice(offset, offset + limit)
  }

  get(id: string): LibraryItem | undefined {
    return this.load().find((i) => i.id === id)
  }

  allTags(): string[] {
    const set = new Set<string>()
    for (const i of this.load()) for (const t of i.tags) set.add(t)
    return [...set].sort()
  }

  async addImage(input: AddImageInput): Promise<LibraryItem> {
    const id = randomUUID()
    const image = nativeImage.createFromDataURL(input.dataUrl)
    const size = image.getSize()

    let filePath = input.existingPath
    if (!filePath) {
      filePath = join(capturesDir(), `${id}.png`)
      await fs.writeFile(filePath, image.toPNG())
    }

    let projectPath: string | undefined
    if (input.project) {
      projectPath = join(projectsDir(), `${id}.clipthat`)
      await fs.writeFile(projectPath, JSON.stringify(input.project), 'utf8')
    }

    const thumbnail = await this.writeThumb(id, image)

    const stat = await fs.stat(filePath).catch(() => null)
    const item: LibraryItem = {
      id,
      title: input.title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      kind: 'image',
      width: input.width || size.width,
      height: input.height || size.height,
      filePath,
      projectPath,
      thumbnail,
      tags: [],
      favorite: false,
      ocrText: input.ocrText,
      byteSize: stat?.size ?? 0
    }

    this.load().unshift(item)
    this.persist()
    this.emit('added', item)
    return item
  }

  async addVideo(input: AddVideoInput): Promise<LibraryItem> {
    const id = randomUUID()
    const target = join(recordingsDir(), `${id}${extOf(input.filePath)}`)
    if (input.filePath !== target) {
      await fs.rename(input.filePath, target).catch(async () => {
        await fs.copyFile(input.filePath, target)
        await fs.rm(input.filePath, { force: true })
      })
    }

    let thumbnail = ''
    if (input.posterDataUrl) {
      thumbnail = await this.writeThumb(id, nativeImage.createFromDataURL(input.posterDataUrl))
    }

    const stat = await fs.stat(target).catch(() => null)
    const item: LibraryItem = {
      id,
      title: input.title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      kind: 'video',
      width: input.width,
      height: input.height,
      filePath: target,
      thumbnail,
      tags: [],
      favorite: false,
      durationMs: input.durationMs,
      byteSize: stat?.size ?? 0
    }

    this.load().unshift(item)
    this.persist()
    return item
  }

  /** Overwrite an existing item's pixels and project after a re-edit. */
  async replaceImage(
    id: string,
    dataUrl: string,
    project?: ClipDocument,
    ocrText?: string
  ): Promise<LibraryItem | undefined> {
    const item = this.get(id)
    if (!item) return undefined
    const image = nativeImage.createFromDataURL(dataUrl)
    await fs.writeFile(item.filePath, image.toPNG())
    if (project) {
      item.projectPath ??= join(projectsDir(), `${id}.clipthat`)
      await fs.writeFile(item.projectPath, JSON.stringify(project), 'utf8')
    }
    item.thumbnail = await this.writeThumb(id, image)
    const size = image.getSize()
    item.width = size.width
    item.height = size.height
    item.updatedAt = Date.now()
    if (ocrText !== undefined) item.ocrText = ocrText
    const stat = await fs.stat(item.filePath).catch(() => null)
    item.byteSize = stat?.size ?? item.byteSize
    this.persist()
    return item
  }

  update(id: string, patch: Partial<LibraryItem>): LibraryItem | undefined {
    const item = this.get(id)
    if (!item) return undefined
    Object.assign(item, patch, { id, updatedAt: Date.now() })
    this.persist()
    return item
  }

  async remove(ids: string[]): Promise<void> {
    const set = new Set(ids)
    const items = this.load()
    const removed = items.filter((i) => set.has(i.id))
    this.items = items.filter((i) => !set.has(i.id))

    await Promise.all(
      removed.flatMap((i) => [
        fs.rm(i.filePath, { force: true }).catch(() => {}),
        i.projectPath ? fs.rm(i.projectPath, { force: true }).catch(() => {}) : Promise.resolve(),
        i.thumbnail
          ? fs.rm(join(thumbsDir(), basename(i.thumbnail)), { force: true }).catch(() => {})
          : Promise.resolve()
      ])
    )
    this.persist()
  }

  async loadProject(id: string): Promise<ClipDocument | null> {
    const item = this.get(id)
    if (!item?.projectPath) return null
    try {
      return JSON.parse(await fs.readFile(item.projectPath, 'utf8')) as ClipDocument
    } catch {
      return null
    }
  }

  private async writeThumb(id: string, image: Electron.NativeImage): Promise<string> {
    const size = image.getSize()
    const scale = Math.min(1, THUMB_MAX / Math.max(size.width, size.height, 1))
    const thumb =
      scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: 'good'
          })
        : image
    const path = join(thumbsDir(), `${id}.png`)
    await fs.writeFile(path, thumb.toPNG())
    return path
  }
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.')
  return i === -1 ? '.mp4' : p.slice(i)
}

export const library = new LibraryStore()
