import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type {
  RecoverableRecording,
  RecoverableRecordingState,
  RecordingOptions
} from '@shared/types'
import { reviewPlaybackPath } from './review-playback'

const MANIFEST_VERSION = 1

interface RecordingManifest {
  version: typeof MANIFEST_VERSION
  id: string
  state: RecoverableRecordingState
  createdAt: number
  updatedAt: number
  mimeType: string
  byteSize: number
  chunkCount: number
  options: RecordingOptions
  width?: number
  height?: number
  durationMs?: number
  failure?: string
}

type ManifestPatch = Partial<
  Pick<
    RecordingManifest,
    'state' | 'mimeType' | 'width' | 'height' | 'durationMs' | 'failure'
  >
>

/**
 * Stores each MediaRecorder stream as an append-only WebM plus a tiny atomic manifest.
 * This module deliberately has no Electron dependency so the durability contract is testable.
 */
export class RecordingRecoveryStore {
  private readonly manifests = new Map<string, RecordingManifest>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly root: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    const names = await fs.readdir(this.root).catch(() => [])
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const raw = JSON.parse(await fs.readFile(join(this.root, name), 'utf8')) as unknown
        const manifest = this.parseManifest(raw)
        if (name !== `${manifest.id}.json`) continue
        const stat = await fs.stat(this.rawPath(manifest.id))
        if (!stat.isFile()) continue
        // The filesystem is authoritative if a crash happened between append and checkpoint.
        manifest.byteSize = stat.size
        this.manifests.set(manifest.id, manifest)
      } catch {
        // Leave malformed artifacts untouched for forensic/manual recovery.
      }
    }
  }

  async create(options: RecordingOptions): Promise<RecoverableRecording> {
    await fs.mkdir(this.root, { recursive: true })
    const id = randomUUID()
    const now = Date.now()
    const manifest: RecordingManifest = {
      version: MANIFEST_VERSION,
      id,
      state: 'recording',
      createdAt: now,
      updatedAt: now,
      mimeType: 'video/webm',
      byteSize: 0,
      chunkCount: 0,
      options: { ...options }
    }
    await fs.writeFile(this.rawPath(id), Buffer.alloc(0), { flag: 'wx' })
    try {
      await this.persist(manifest)
    } catch (err) {
      await fs.rm(this.rawPath(id), { force: true }).catch(() => {})
      throw err
    }
    this.manifests.set(id, manifest)
    return this.publicValue(manifest)
  }

  append(
    id: string,
    sequence: number,
    bytes: Uint8Array,
    mimeType: string,
    durationMs?: number
  ): Promise<RecoverableRecording> {
    return this.enqueue(id, async () => {
      const manifest = this.require(id)
      if (sequence !== manifest.chunkCount) {
        throw new Error(
          `Recording chunk ${sequence} arrived out of order; expected ${manifest.chunkCount}`
        )
      }
      await fs.appendFile(this.rawPath(id), Buffer.from(bytes))
      manifest.chunkCount += 1
      manifest.byteSize += bytes.byteLength
      manifest.mimeType = mimeType
      if (durationMs !== undefined) manifest.durationMs = durationMs
      manifest.updatedAt = Date.now()
      await this.persist(manifest)
      return this.publicValue(manifest)
    })
  }

  update(id: string, patch: ManifestPatch): Promise<RecoverableRecording> {
    return this.enqueue(id, async () => {
      const manifest = this.require(id)
      Object.assign(manifest, patch, { updatedAt: Date.now() })
      if (patch.state !== 'failed') delete manifest.failure
      await this.persist(manifest)
      return this.publicValue(manifest)
    })
  }

  get(id: string): RecoverableRecording | undefined {
    const manifest = this.manifests.get(id)
    return manifest ? this.publicValue(manifest) : undefined
  }

  list(): RecoverableRecording[] {
    return [...this.manifests.values()]
      .filter((manifest) => manifest.byteSize > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((manifest) => this.publicValue(manifest))
  }

  remove(id: string): Promise<void> {
    return this.enqueue(id, async () => {
      this.manifests.delete(id)
      await Promise.all([
        fs.rm(this.rawPath(id), { force: true }),
        fs.rm(this.playbackPath(id), { force: true }),
        fs.rm(this.manifestPath(id), { force: true }),
        fs.rm(this.tempManifestPath(id), { force: true })
      ])
    }).finally(() => this.queues.delete(id))
  }

  ownsRawPath(filePath: string): boolean {
    const absolute = resolve(filePath)
    return [...this.manifests.keys()].some(
      (id) =>
        absolute === resolve(this.rawPath(id)) || absolute === resolve(this.playbackPath(id))
    )
  }

  private enqueue<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.queues.set(id, next)
    void next.finally(() => {
      if (this.queues.get(id) === next) this.queues.delete(id)
    }).catch(() => {})
    return next
  }

  private require(id: string): RecordingManifest {
    const manifest = this.manifests.get(id)
    if (!manifest) throw new Error('Recording recovery session was not found')
    return manifest
  }

  private async persist(manifest: RecordingManifest): Promise<void> {
    const temp = this.tempManifestPath(manifest.id)
    await fs.writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await fs.rename(temp, this.manifestPath(manifest.id))
  }

  private publicValue(manifest: RecordingManifest): RecoverableRecording {
    const rawPath = this.rawPath(manifest.id)
    const playbackPath = this.playbackPath(manifest.id)
    return {
      ...manifest,
      options: { ...manifest.options },
      rawPath,
      playbackPath: existsSync(playbackPath) ? playbackPath : undefined
    }
  }

  private rawPath(id: string): string {
    return join(this.root, `${id}.webm`)
  }

  private playbackPath(id: string): string {
    return reviewPlaybackPath(this.rawPath(id))
  }

  private manifestPath(id: string): string {
    return join(this.root, `${id}.json`)
  }

  private tempManifestPath(id: string): string {
    return join(this.root, `${id}.json.tmp`)
  }

  private parseManifest(value: unknown): RecordingManifest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('bad manifest')
    const input = value as Record<string, unknown>
    const id = typeof input.id === 'string' ? input.id : ''
    const state = input.state
    if (
      input.version !== MANIFEST_VERSION ||
      !/^[0-9a-f-]{36}$/i.test(id) ||
      basename(id) !== id ||
      (state !== 'recording' && state !== 'ready' && state !== 'failed') ||
      typeof input.createdAt !== 'number' ||
      typeof input.updatedAt !== 'number' ||
      typeof input.mimeType !== 'string' ||
      typeof input.byteSize !== 'number' ||
      typeof input.chunkCount !== 'number' ||
      !input.options ||
      typeof input.options !== 'object'
    ) {
      throw new Error('bad manifest')
    }
    return value as RecordingManifest
  }
}
