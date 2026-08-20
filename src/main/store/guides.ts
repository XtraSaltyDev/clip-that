import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { nativeImage } from 'electron'
import type {
  CaptureResult,
  ClipDocument,
  GuideDocument,
  GuideSourceMetadata,
  GuideStep,
  GuideSummary
} from '@shared/types'
import { GUIDE_MAX_STEPS, GUIDE_VERSION, renumberGuideSteps } from '@shared/guides'
import { clipDocument, guideDocument } from '../ipc/validation'
import { guidesDir } from './paths'
import { isPathInside, isRealPathInside } from './path-guard'
import { atomicGuideWrite } from './guide-files'

interface StoredGuideStepV1 {
  version: 1
  id: string
  order: number
  title: string
  description: string
  createdAt: number
  updatedAt: number
  image: string
  project: string
  thumbnail: string
  renderedImage?: string
  imageWidth: number
  imageHeight: number
  source?: GuideSourceMetadata
  pointer?: { x: number; y: number }
}

interface StoredGuideV1 {
  version: 1
  id: string
  title: string
  description: string
  createdAt: number
  updatedAt: number
  steps: StoredGuideStepV1[]
}

const MANIFEST = 'guide.json'
const BACKUP = 'guide.json.bak'
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MAX_PROJECT_BYTES = 64 * 1024 * 1024
const MAX_ASSET_BYTES = 64 * 1024 * 1024

function storedRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function rejectStoredUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const fields = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new TypeError(`${label} field ${key} is unsupported`)
  }
}

async function readBounded(path: string, maxBytes: number): Promise<Buffer> {
  const info = await fs.stat(path)
  if (!info.isFile() || info.size > maxBytes) throw new TypeError('Guide file is too large')
  return fs.readFile(path)
}

function dataBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new TypeError('Guide image data is invalid')
  return Buffer.from(dataUrl.slice(comma + 1), 'base64')
}

function publicProject(project: ClipDocument): ClipDocument {
  const next = { ...project }
  delete next.exportPath
  return next
}

export function guideThumbnail(dataUrl: string): string {
  const source = nativeImage.createFromDataURL(dataUrl)
  if (source.isEmpty()) throw new TypeError('Guide image could not be decoded')
  const size = source.getSize()
  const scale = Math.min(1, 320 / Math.max(size.width, size.height))
  return source
    .resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'best'
    })
    .toDataURL()
}

export class GuideStore extends EventEmitter {
  private cache = new Map<string, GuideDocument>()
  private saveQueues = new Map<string, Promise<void>>()

  async initialize(): Promise<void> {
    await fs.mkdir(guidesDir(), { recursive: true })
    const entries = await fs.readdir(guidesDir(), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const loaded = await this.loadFromDisk(entry.name)
      if (loaded) this.cache.set(loaded.id, loaded)
    }
  }

  list(search = ''): GuideSummary[] {
    const needle = search.trim().toLocaleLowerCase()
    return [...this.cache.values()]
      .filter((guide) => {
        if (!needle) return true
        return (
          guide.title.toLocaleLowerCase().includes(needle) ||
          guide.description.toLocaleLowerCase().includes(needle) ||
          guide.steps.some(
            (step) =>
              step.title.toLocaleLowerCase().includes(needle) ||
              step.description.toLocaleLowerCase().includes(needle)
          )
        )
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((guide) => ({
        id: guide.id,
        title: guide.title,
        description: guide.description,
        createdAt: guide.createdAt,
        updatedAt: guide.updatedAt,
        stepCount: guide.steps.length,
        thumbnail: guide.steps[0]?.thumbnail
      }))
  }

  get(id: string): GuideDocument | undefined {
    const guide = this.cache.get(id)
    return guide ? structuredClone(guide) : undefined
  }

  async create(title = 'Untitled guide'): Promise<GuideDocument> {
    const now = Date.now()
    const guide: GuideDocument = {
      version: GUIDE_VERSION,
      id: randomUUID(),
      title,
      description: '',
      createdAt: now,
      updatedAt: now,
      steps: []
    }
    this.cache.set(guide.id, guide)
    await this.persist(guide)
    this.emit('changed')
    return structuredClone(guide)
  }

  async save(value: GuideDocument): Promise<GuideDocument> {
    const validated = guideDocument(value)
    if (!this.cache.has(validated.id)) throw new Error('Guide no longer exists')
    const current = this.cache.get(validated.id)!
    const next = {
      ...structuredClone(validated),
      createdAt: current.createdAt,
      updatedAt: Date.now(),
      steps: renumberGuideSteps(validated.steps)
    }
    this.cache.set(next.id, next)
    try {
      await this.persist(next)
    } catch (error) {
      this.cache.set(current.id, current)
      throw error
    }
    this.emit('changed')
    return structuredClone(next)
  }

  async addCapture(
    guideId: string,
    capture: CaptureResult,
    project: ClipDocument,
    source: GuideSourceMetadata
  ): Promise<GuideDocument> {
    const guide = this.get(guideId)
    if (!guide) throw new Error('Guide no longer exists')
    if (guide.steps.length >= GUIDE_MAX_STEPS) throw new Error('Guide step limit reached')
    const now = Date.now()
    const cleanProject = publicProject(clipDocument(project))
    const step: GuideStep = {
      version: GUIDE_VERSION,
      id: randomUUID(),
      order: guide.steps.length,
      title: capture.title?.trim() || `Step ${guide.steps.length + 1}`,
      description: '',
      createdAt: now,
      updatedAt: now,
      image: capture.dataUrl,
      imageWidth: capture.width,
      imageHeight: capture.height,
      project: cleanProject,
      thumbnail: guideThumbnail(capture.dataUrl),
      source
    }
    return this.save({ ...guide, steps: [...guide.steps, step] })
  }

  async saveEditedStep(
    guideId: string,
    stepId: string,
    project: ClipDocument,
    renderedImage: string
  ): Promise<GuideDocument> {
    const guide = this.get(guideId)
    if (!guide) throw new Error('Guide no longer exists')
    const index = guide.steps.findIndex((step) => step.id === stepId)
    if (index < 0) throw new Error('Guide step no longer exists')
    guide.steps[index] = {
      ...guide.steps[index],
      project: publicProject(clipDocument(project)),
      renderedImage,
      thumbnail: guideThumbnail(renderedImage),
      updatedAt: Date.now()
    }
    return this.save(guide)
  }

  async replaceCapture(
    guideId: string,
    stepId: string,
    capture: CaptureResult,
    project: ClipDocument
  ): Promise<GuideDocument> {
    const guide = this.get(guideId)
    if (!guide) throw new Error('Guide no longer exists')
    const index = guide.steps.findIndex((step) => step.id === stepId)
    if (index < 0) throw new Error('Guide step no longer exists')
    guide.steps[index] = {
      ...guide.steps[index],
      image: capture.dataUrl,
      imageWidth: capture.width,
      imageHeight: capture.height,
      project: publicProject(clipDocument(project)),
      renderedImage: undefined,
      thumbnail: guideThumbnail(capture.dataUrl),
      source: { kind: 'capture', captureMode: capture.source },
      updatedAt: Date.now()
    }
    return this.save(guide)
  }

  async remove(id: string): Promise<boolean> {
    if (!this.cache.delete(id)) return false
    const root = join(guidesDir(), id)
    if (!isPathInside(guidesDir(), root)) throw new Error('Invalid guide path')
    await fs.rm(root, { recursive: true, force: true })
    this.emit('changed')
    return true
  }

  private async persist(guide: GuideDocument): Promise<void> {
    const prior = this.saveQueues.get(guide.id) ?? Promise.resolve()
    const next = prior.then(() => this.writeGuide(guide))
    this.saveQueues.set(guide.id, next)
    try {
      await next
    } finally {
      if (this.saveQueues.get(guide.id) === next) this.saveQueues.delete(guide.id)
    }
  }

  private async writeGuide(guide: GuideDocument): Promise<void> {
    const root = join(guidesDir(), guide.id)
    if (!isPathInside(guidesDir(), root)) throw new Error('Invalid guide path')
    await fs.mkdir(root, { recursive: true })
    if (!(await isRealPathInside(guidesDir(), root))) throw new Error('Invalid guide path')
    const assets = join(root, 'assets')
    const projects = join(root, 'projects')
    const thumbnails = join(root, 'thumbnails')
    await Promise.all([
      fs.mkdir(assets, { recursive: true }),
      fs.mkdir(projects, { recursive: true }),
      fs.mkdir(thumbnails, { recursive: true })
    ])
    for (const directory of [assets, projects, thumbnails]) {
      if (!(await isRealPathInside(root, directory))) throw new Error('Invalid guide asset path')
    }

    const storedSteps: StoredGuideStepV1[] = []
    for (const step of guide.steps) {
      const imagePath = `assets/${step.id}.png`
      const renderedPath = step.renderedImage ? `assets/${step.id}-rendered.png` : undefined
      const projectPath = `projects/${step.id}.clipthat`
      const thumbnailPath = `thumbnails/${step.id}.png`
      await Promise.all([
        atomicGuideWrite(join(root, imagePath), dataBuffer(step.image)),
        renderedPath
          ? atomicGuideWrite(join(root, renderedPath), dataBuffer(step.renderedImage!))
          : Promise.resolve(),
        atomicGuideWrite(join(root, projectPath), JSON.stringify(publicProject(step.project))),
        atomicGuideWrite(join(root, thumbnailPath), dataBuffer(step.thumbnail))
      ])
      storedSteps.push({
        version: GUIDE_VERSION,
        id: step.id,
        order: step.order,
        title: step.title,
        description: step.description,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
        image: imagePath,
        project: projectPath,
        thumbnail: thumbnailPath,
        renderedImage: renderedPath,
        imageWidth: step.imageWidth,
        imageHeight: step.imageHeight,
        source: step.source,
        pointer: step.pointer
      })
    }
    const manifest: StoredGuideV1 = {
      version: GUIDE_VERSION,
      id: guide.id,
      title: guide.title,
      description: guide.description,
      createdAt: guide.createdAt,
      updatedAt: guide.updatedAt,
      steps: storedSteps
    }
    const target = join(root, MANIFEST)
    const backup = join(root, BACKUP)
    if (await isRealPathInside(root, target)) {
      const current = await readBounded(target, MAX_MANIFEST_BYTES)
      await atomicGuideWrite(backup, current)
    }
    await atomicGuideWrite(target, JSON.stringify(manifest, null, 2))
  }

  private async loadFromDisk(id: string): Promise<GuideDocument | null> {
    const root = join(guidesDir(), id)
    if (!(await isRealPathInside(guidesDir(), root))) return null
    for (const name of [MANIFEST, BACKUP]) {
      try {
        const manifestPath = join(root, name)
        if (!(await isRealPathInside(root, manifestPath))) {
          throw new TypeError('Guide manifest path is invalid')
        }
        const manifest = JSON.parse(
          (await readBounded(manifestPath, MAX_MANIFEST_BYTES)).toString('utf8')
        ) as StoredGuideV1
        const manifestRecord = storedRecord(manifest, 'guide manifest')
        rejectStoredUnknown(
          manifestRecord,
          ['version', 'id', 'title', 'description', 'createdAt', 'updatedAt', 'steps'],
          'guide manifest'
        )
        if (
          manifest.version !== GUIDE_VERSION ||
          manifest.id !== id ||
          !Array.isArray(manifest.steps) ||
          manifest.steps.length > GUIDE_MAX_STEPS
        ) {
          throw new TypeError('Unsupported guide manifest')
        }
        const steps: GuideStep[] = []
        for (const stored of manifest.steps) {
          const storedStep = storedRecord(stored, 'guide step manifest')
          rejectStoredUnknown(
            storedStep,
            [
              'version',
              'id',
              'order',
              'title',
              'description',
              'createdAt',
              'updatedAt',
              'image',
              'project',
              'thumbnail',
              'renderedImage',
              'imageWidth',
              'imageHeight',
              'source',
              'pointer'
            ],
            'guide step manifest'
          )
          const resolve = async (relative: unknown): Promise<string> => {
            if (typeof relative !== 'string' || relative.includes('\0')) {
              throw new TypeError('Guide asset path is invalid')
            }
            const path = join(root, relative)
            if (!isPathInside(root, path)) throw new TypeError('Guide asset path is invalid')
            if (!(await isRealPathInside(root, path))) {
              throw new TypeError('Guide asset path is invalid')
            }
            return path
          }
          const [imagePath, projectPath, thumbnailPath, renderedPath] = await Promise.all([
            resolve(stored.image),
            resolve(stored.project),
            resolve(stored.thumbnail),
            stored.renderedImage === undefined
              ? Promise.resolve(undefined)
              : resolve(stored.renderedImage)
          ])
          const [imageBytes, projectText, thumbnailBytes, renderedBytes] = await Promise.all([
            readBounded(imagePath, MAX_ASSET_BYTES),
            readBounded(projectPath, MAX_PROJECT_BYTES).then((value) => value.toString('utf8')),
            readBounded(thumbnailPath, MAX_ASSET_BYTES),
            renderedPath ? readBounded(renderedPath, MAX_ASSET_BYTES) : undefined
          ])
          steps.push({
            version: GUIDE_VERSION,
            id: stored.id,
            order: stored.order,
            title: stored.title,
            description: stored.description,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            image: `data:image/png;base64,${imageBytes.toString('base64')}`,
            imageWidth: stored.imageWidth,
            imageHeight: stored.imageHeight,
            project: clipDocument(JSON.parse(projectText)),
            thumbnail: `data:image/png;base64,${thumbnailBytes.toString('base64')}`,
            renderedImage: renderedBytes
              ? `data:image/png;base64,${renderedBytes.toString('base64')}`
              : undefined,
            source: stored.source,
            pointer: stored.pointer
          })
        }
        const guide = guideDocument({ ...manifest, steps })
        if (name === BACKUP) {
          // A recovered guide must become the next good primary before later saves rotate backups.
          await atomicGuideWrite(join(root, MANIFEST), JSON.stringify(manifest, null, 2))
        }
        return guide
      } catch {
        // Try the backup before abandoning this guide. A failed primary remains on disk.
      }
    }
    return null
  }
}

export const guides = new GuideStore()
