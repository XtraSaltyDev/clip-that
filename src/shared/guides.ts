import type {
  CaptureResult,
  ClipDocument,
  GuideDocument,
  GuidePointer,
  GuideSourceMetadata,
  GuideStep
} from './types'

export const GUIDE_VERSION = 1 as const
export const GUIDE_MAX_STEPS = 100
export const GUIDE_MAX_TEXT = 20_000
export const GUIDE_MAX_IMAGE_BYTES = 64 * 1024 * 1024
export const GUIDE_MAX_TOTAL_PAYLOAD_BYTES = 512 * 1024 * 1024

const imagePattern = /^data:image\/(?:png|jpeg|jpg|webp);base64,/i

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exact(input: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = new Set(allowed)
  for (const key of Object.keys(input)) {
    if (!keys.has(key)) throw new TypeError(`${label} field ${key} is not supported`)
  }
}

function text(value: unknown, label: string, max = GUIDE_MAX_TEXT): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

function id(value: unknown, label: string): string {
  const result = text(value, label, 128)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(result)) {
    throw new TypeError(`${label} is invalid`)
  }
  return result
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

function dimension(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 200_000) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

function image(value: unknown, label: string): string {
  const result = text(value, label, Math.ceil((GUIDE_MAX_IMAGE_BYTES * 4) / 3) + 256)
  if (!imagePattern.test(result)) throw new TypeError(`${label} must be an image data URL`)
  return result
}

function pointer(value: unknown): GuidePointer | undefined {
  if (value === undefined) return undefined
  const input = object(value, 'guide pointer')
  exact(input, ['x', 'y'], 'guide pointer')
  if (
    typeof input.x !== 'number' ||
    typeof input.y !== 'number' ||
    input.x < 0 ||
    input.x > 1 ||
    input.y < 0 ||
    input.y > 1
  ) {
    throw new TypeError('guide pointer must use normalized coordinates')
  }
  return { x: input.x, y: input.y }
}

function source(value: unknown): GuideSourceMetadata | undefined {
  if (value === undefined) return undefined
  const input = object(value, 'guide source')
  exact(input, ['kind', 'captureMode', 'label'], 'guide source')
  if (input.kind !== 'capture' && input.kind !== 'import') {
    throw new TypeError('guide source kind is unsupported')
  }
  const result: GuideSourceMetadata = { kind: input.kind }
  if (input.captureMode !== undefined) {
    const mode = text(input.captureMode, 'guide capture mode', 32)
    if (!['region', 'window', 'display', 'fullscreen', 'lastRegion', 'scrolling'].includes(mode)) {
      throw new TypeError('guide capture mode is unsupported')
    }
    result.captureMode = mode as GuideSourceMetadata['captureMode']
  }
  if (input.label !== undefined) result.label = text(input.label, 'guide source label', 240)
  return result
}

export function validateGuideStep(
  value: unknown,
  validateProject: (project: unknown) => ClipDocument
): GuideStep {
  const input = object(value, 'guide step')
  exact(
    input,
    [
      'version',
      'id',
      'order',
      'title',
      'description',
      'createdAt',
      'updatedAt',
      'image',
      'imageWidth',
      'imageHeight',
      'project',
      'thumbnail',
      'renderedImage',
      'source',
      'pointer'
    ],
    'guide step'
  )
  if (input.version !== GUIDE_VERSION) throw new TypeError('guide step version is not supported')
  const order = timestamp(input.order, 'guide step order')
  if (order >= GUIDE_MAX_STEPS)
    throw new TypeError('guide step order is outside the supported range')
  return {
    version: GUIDE_VERSION,
    id: id(input.id, 'guide step id'),
    order,
    title: text(input.title, 'guide step title', 240),
    description: text(input.description, 'guide step description'),
    createdAt: timestamp(input.createdAt, 'guide step creation time'),
    updatedAt: timestamp(input.updatedAt, 'guide step update time'),
    image: image(input.image, 'guide step image'),
    imageWidth: dimension(input.imageWidth, 'guide step width'),
    imageHeight: dimension(input.imageHeight, 'guide step height'),
    project: validateProject(input.project),
    thumbnail: image(input.thumbnail, 'guide step thumbnail'),
    renderedImage:
      input.renderedImage === undefined
        ? undefined
        : image(input.renderedImage, 'guide step rendered image'),
    source: source(input.source),
    pointer: pointer(input.pointer)
  }
}

export function validateGuideDocument(
  value: unknown,
  validateProject: (project: unknown) => ClipDocument
): GuideDocument {
  const input = object(value, 'guide')
  exact(
    input,
    ['version', 'id', 'title', 'description', 'createdAt', 'updatedAt', 'steps'],
    'guide'
  )
  if (input.version !== GUIDE_VERSION) throw new TypeError('guide version is not supported')
  if (!Array.isArray(input.steps) || input.steps.length > GUIDE_MAX_STEPS) {
    throw new TypeError('guide has too many steps')
  }
  const steps = input.steps.map((step) => validateGuideStep(step, validateProject))
  const totalPayloadCharacters = steps.reduce(
    (total, step) =>
      total +
      step.image.length +
      step.thumbnail.length +
      (step.renderedImage?.length ?? 0) +
      JSON.stringify(step.project).length,
    0
  )
  if (totalPayloadCharacters > Math.ceil((GUIDE_MAX_TOTAL_PAYLOAD_BYTES * 4) / 3) + 1024) {
    throw new TypeError('guide payload is too large')
  }
  const ids = new Set(steps.map((step) => step.id))
  if (ids.size !== steps.length) throw new TypeError('guide step ids must be unique')
  steps.sort((a, b) => a.order - b.order)
  steps.forEach((step, index) => {
    if (step.order !== index) throw new TypeError('guide step order must be contiguous')
  })
  return {
    version: GUIDE_VERSION,
    id: id(input.id, 'guide id'),
    title: text(input.title, 'guide title', 240),
    description: text(input.description, 'guide description'),
    createdAt: timestamp(input.createdAt, 'guide creation time'),
    updatedAt: timestamp(input.updatedAt, 'guide update time'),
    steps
  }
}

export function renumberGuideSteps(steps: readonly GuideStep[]): GuideStep[] {
  return steps.map((step, order) => ({ ...step, order }))
}

export function createGuideStep(
  capture: CaptureResult,
  project: ClipDocument,
  thumbnail: string,
  sourceMetadata: GuideSourceMetadata = { kind: 'capture', captureMode: capture.source }
): GuideStep {
  const now = Date.now()
  return {
    version: GUIDE_VERSION,
    id: crypto.randomUUID(),
    order: 0,
    title: capture.title?.trim() || 'Untitled step',
    description: '',
    createdAt: now,
    updatedAt: now,
    image: capture.dataUrl,
    imageWidth: capture.width,
    imageHeight: capture.height,
    project,
    thumbnail,
    source: sourceMetadata
  }
}

export function moveGuideStep(
  steps: readonly GuideStep[],
  stepId: string,
  toIndex: number
): GuideStep[] {
  const from = steps.findIndex((step) => step.id === stepId)
  if (from < 0) throw new Error('Guide step no longer exists')
  const bounded = Math.max(0, Math.min(steps.length - 1, Math.trunc(toIndex)))
  const next = [...steps]
  const [step] = next.splice(from, 1)
  next.splice(bounded, 0, step)
  return renumberGuideSteps(next)
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return escaped[character]
  })
}

export function markdownText(value: string): string {
  return value.replace(/([\\`*_[\]<>#])/g, '\\$1')
}
