import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { nativeImage } from 'electron'
import type {
  ClipDocument,
  LibraryHealth,
  LibraryItem,
  LibraryItemPatch,
  LibraryQuery
} from '@shared/types'
import {
  capturesDir,
  libraryIndexBackupFile,
  libraryIndexFile,
  projectsDir,
  recordingsDir,
  thumbsDir
} from './paths'
import { isPathInside, isRealPathInside } from './path-guard'
import { clipDocument } from '../ipc/validation'
import {
  discoverLibraryFiles,
  loadLibraryIndex,
  persistLibraryIndex,
  type LibraryIndexLoadResult
} from './library-index'

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
  private loadResult: LibraryIndexLoadResult | null = null
  private startupHealth: LibraryHealth | null = null
  private runtimeHealth: LibraryHealth | null = null
  private initialized = false

  private load(): LibraryItem[] {
    if (this.items) return this.items
    this.loadResult = loadLibraryIndex(libraryIndexFile(), libraryIndexBackupFile())
    this.items = this.loadResult.items
    if (this.loadResult.warning) {
      this.startupHealth = {
        status: this.loadResult.source === 'empty' ? 'error' : 'warning',
        message: this.loadResult.warning,
        detail: this.loadResult.detail
      }
    }
    return this.items
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    const loaded = this.load()
    let reconciliation: Awaited<ReturnType<LibraryStore['reconcile']>>
    try {
      reconciliation = await this.reconcile(loaded)
    } catch (error) {
      console.error('[library] startup reconciliation failed', error)
      this.startupHealth = {
        status: 'error',
        message: 'The Library could not verify its files at startup',
        detail: (error as Error).message
      }
      return
    }
    const { items, recovered, removed, repairedMetadata } = reconciliation
    const changed = recovered > 0 || removed > 0 || repairedMetadata > 0
    const canRepairUnreadable = this.loadResult?.source !== 'empty' || recovered > 0

    if (changed || (this.loadResult?.needsRepair && canRepairUnreadable)) {
      try {
        this.commit(items, false)
      } catch {
        return
      }
    }

    if (changed) {
      const parts = [
        recovered > 0 ? `${recovered} file(s) recovered` : '',
        removed > 0 ? `${removed} missing record(s) removed` : '',
        repairedMetadata > 0 ? `${repairedMetadata} metadata record(s) repaired` : ''
      ].filter(Boolean)
      this.startupHealth = {
        status: 'warning',
        message: 'The Library was reconciled with its files',
        detail: parts.join('; '),
        recoveredItems: recovered
      }
    } else if (this.loadResult?.source === 'backup') {
      this.startupHealth = {
        status: 'warning',
        message: 'The Library index was restored from its backup',
        detail: this.loadResult.detail
      }
    }
  }

  health(): LibraryHealth {
    return (
      this.runtimeHealth ??
      this.startupHealth ?? { status: 'ok', message: 'Library storage is healthy' }
    )
  }

  private commit(items: LibraryItem[], emitChanged = true): void {
    const recoveredFromRuntimeIssue = this.runtimeHealth !== null
    try {
      persistLibraryIndex(libraryIndexFile(), libraryIndexBackupFile(), items)
      this.items = items
      this.runtimeHealth = null
    } catch (err) {
      console.error('[library] index write failed', err)
      this.runtimeHealth = {
        status: 'error',
        message: 'Library changes could not be saved',
        detail: (err as Error).message
      }
      this.emit('issue', this.health())
      throw err
    }
    if (emitChanged) this.emit('changed')
    if (recoveredFromRuntimeIssue) this.emit('issue', this.health())
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

    this.commit([item, ...this.load()])
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

    this.commit([item, ...this.load()])
    return item
  }

  /** Overwrite an existing item's pixels and project after a re-edit. */
  async replaceImage(
    id: string,
    dataUrl: string,
    project?: ClipDocument,
    ocrText?: string
  ): Promise<LibraryItem | undefined> {
    const current = this.get(id)
    if (!current) return undefined
    const image = nativeImage.createFromDataURL(dataUrl)
    await fs.writeFile(current.filePath, image.toPNG())
    const item = { ...current }
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
    this.commit(this.load().map((candidate) => (candidate.id === id ? item : candidate)))
    return item
  }

  update(id: string, patch: LibraryItemPatch): LibraryItem | undefined {
    const current = this.get(id)
    if (!current) return undefined
    const item = { ...current, tags: [...current.tags] }
    if (patch.title !== undefined) item.title = patch.title.trim().slice(0, 240) || item.title
    if (patch.exportPath !== undefined) item.exportPath = patch.exportPath
    if (patch.tags !== undefined) {
      item.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 50)
    }
    if (patch.favorite !== undefined) item.favorite = patch.favorite
    if (patch.ocrText !== undefined) item.ocrText = patch.ocrText.slice(0, 2_000_000)
    if (patch.videoEdit !== undefined) {
      if (current.kind !== 'video') throw new TypeError('Only recordings can have video edit drafts')
      if (patch.videoEdit === null) delete item.videoEdit
      else item.videoEdit = { ...patch.videoEdit }
    }
    item.updatedAt = Date.now()
    this.commit(this.load().map((candidate) => (candidate.id === id ? item : candidate)))
    return item
  }

  /** Deterministic timeline seeding for the development-only visual harness. */
  setCreatedAtForVisualCheck(id: string, createdAt: number): void {
    const current = this.get(id)
    if (!current) return
    const item = { ...current, createdAt }
    this.commit(this.load().map((candidate) => (candidate.id === id ? item : candidate)))
  }

  /** Exact allowlist for renderer requests that reveal or open a library-owned record. */
  ownsPath(filePath: string): boolean {
    const target = resolve(filePath)
    return this.load().some((item) =>
      [item.filePath, item.projectPath, item.thumbnail]
        .filter((path): path is string => Boolean(path))
        .some((path) => resolve(path) === target)
    )
  }

  async remove(ids: string[]): Promise<void> {
    const set = new Set(ids)
    const items = this.load()
    const removed = items.filter((i) => set.has(i.id))
    const next = items.filter((i) => !set.has(i.id))

    // Make the removal durable before deleting files. A failed index write leaves every
    // asset and the old index intact, so the user can safely retry.
    this.commit(next)

    const failures = (
      await Promise.all(
        removed.flatMap((i) => [
          isPathInside(capturesDir(), i.filePath) || isPathInside(recordingsDir(), i.filePath)
            ? fs.rm(i.filePath, { force: true }).then(
                () => null,
                (error) => error as Error
              )
            : Promise.resolve(null),
          i.projectPath && isPathInside(projectsDir(), i.projectPath)
            ? fs.rm(i.projectPath, { force: true }).then(
                () => null,
                (error) => error as Error
              )
            : Promise.resolve(null),
          i.thumbnail
            ? fs.rm(join(thumbsDir(), basename(i.thumbnail)), { force: true }).then(
                () => null,
                (error) => error as Error
              )
            : Promise.resolve(null)
        ])
      )
    ).filter((error): error is Error => error instanceof Error)
    if (failures.length > 0) {
      this.runtimeHealth = {
        status: 'warning',
        message: 'Some deleted Library files could not be removed',
        detail: failures[0].message
      }
      this.emit('issue', this.health())
    }
  }

  async loadProject(id: string): Promise<ClipDocument | null> {
    const item = this.get(id)
    if (!item?.projectPath) return null
    try {
      if (!(await isRealPathInside(projectsDir(), item.projectPath))) return null
      return clipDocument(JSON.parse(await fs.readFile(item.projectPath, 'utf8')))
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

  private async reconcile(items: LibraryItem[]): Promise<{
    items: LibraryItem[]
    recovered: number
    removed: number
    repairedMetadata: number
  }> {
    const valid: LibraryItem[] = []
    let removed = 0
    let repairedMetadata = 0

    for (const item of items) {
      const root = item.kind === 'image' ? capturesDir() : recordingsDir()
      const owned = isPathInside(root, item.filePath) && (await isRealPathInside(root, item.filePath))
      if (!owned) {
        removed += 1
        continue
      }
      const stat = await fs.stat(item.filePath).catch(() => null)
      if (!stat?.isFile()) {
        removed += 1
        continue
      }

      let next = item
      if (item.kind === 'image' && (!item.thumbnail || !(await this.fileExists(item.thumbnail)))) {
        const image = nativeImage.createFromPath(item.filePath)
        if (!image.isEmpty()) {
          next = { ...item, thumbnail: await this.writeThumb(item.id, image), byteSize: stat.size }
          repairedMetadata += 1
        }
      } else if (item.byteSize !== stat.size) {
        next = { ...item, byteSize: stat.size }
        repairedMetadata += 1
      }
      valid.push(next)
    }

    const referenced = new Set(valid.map((item) => resolve(item.filePath)))
    const usedIds = new Set(valid.map((item) => item.id))
    const recoveredItems: LibraryItem[] = []
    const discovered = await discoverLibraryFiles(capturesDir(), recordingsDir(), referenced)
    for (const { filePath, kind } of discovered) {
      const recovered = await this.recoverFile(filePath, kind, usedIds)
      if (!recovered) continue
      recoveredItems.push(recovered)
      usedIds.add(recovered.id)
    }

    return {
      items: [...recoveredItems, ...valid].sort((a, b) => b.createdAt - a.createdAt),
      recovered: recoveredItems.length,
      removed,
      repairedMetadata
    }
  }

  private async recoverFile(
    filePath: string,
    kind: LibraryItem['kind'],
    usedIds: Set<string>
  ): Promise<LibraryItem | null> {
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile()) return null
    const stem = basename(filePath, extname(filePath))
    const id = !usedIds.has(stem) && /^[0-9a-f-]{36}$/i.test(stem) ? stem : randomUUID()
    const projectCandidate = join(projectsDir(), `${stem}.clipthat`)
    const thumbCandidate = join(thumbsDir(), `${stem}.png`)
    let project: ClipDocument | null = null
    if (kind === 'image' && (await this.fileExists(projectCandidate))) {
      project = await fs
        .readFile(projectCandidate, 'utf8')
        .then(
          (text) => clipDocument(JSON.parse(text)),
          () => null
        )
        .catch(() => null)
    }

    let width = 1
    let height = 1
    let thumbnail = (await this.fileExists(thumbCandidate)) ? thumbCandidate : ''
    if (kind === 'image') {
      const image = nativeImage.createFromPath(filePath)
      if (image.isEmpty()) return null
      const size = image.getSize()
      width = size.width
      height = size.height
      if (!thumbnail) thumbnail = await this.writeThumb(id, image)
    }

    return {
      id,
      title: project?.title?.trim() || `Recovered ${kind === 'image' ? 'capture' : 'recording'}`,
      createdAt: stat.birthtimeMs || stat.mtimeMs,
      updatedAt: stat.mtimeMs,
      kind,
      width,
      height,
      filePath,
      projectPath: project ? projectCandidate : undefined,
      thumbnail,
      tags: [],
      favorite: false,
      ocrText: project?.ocrText,
      byteSize: stat.size
    }
  }

  private async fileExists(path: string): Promise<boolean> {
    return fs.stat(path).then((stat) => stat.isFile(), () => false)
  }
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.')
  return i === -1 ? '.mp4' : p.slice(i)
}

export const library = new LibraryStore()
