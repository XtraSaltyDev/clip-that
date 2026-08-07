import type {
  CaptureRequest,
  ClipDocument,
  LibraryItemPatch,
  LibraryQuery,
  RecordingOptions,
  Rect,
  SaveImageRequest,
  VideoExportOptions
} from '@shared/types'

const MAX_IMAGE_DATA_URL = 256 * 1024 * 1024
const MAX_RECORDING_BYTES = 1024 * 1024 * 1024
const MAX_PROJECT_JSON = 64 * 1024 * 1024

type UnknownRecord = Record<string, unknown>

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as UnknownRecord
}

function stringValue(value: unknown, label: string, max = 10_000): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) {
    throw new TypeError(`${label} must be a valid string`)
  }
  return value
}

function optionalString(value: unknown, label: string, max = 10_000): string | undefined {
  return value === undefined ? undefined : stringValue(value, label, max)
}

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${label} is outside the supported range`)
  }
  return value
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be true or false`)
  return value
}

function enumValue<T extends string>(value: unknown, label: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new TypeError(`${label} is not supported`)
  }
  return value as T
}

export function imageDataUrl(value: unknown, label = 'image'): string {
  const url = stringValue(value, label, MAX_IMAGE_DATA_URL)
  if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(url)) {
    throw new TypeError(`${label} must be a PNG, JPEG, or WebP data URL`)
  }
  return url
}

export function rectValue(value: unknown, label = 'rectangle'): Rect {
  const input = record(value, label)
  return {
    x: finite(input.x, `${label}.x`, -1_000_000, 1_000_000),
    y: finite(input.y, `${label}.y`, -1_000_000, 1_000_000),
    width: finite(input.width, `${label}.width`, 0, 1_000_000),
    height: finite(input.height, `${label}.height`, 0, 1_000_000)
  }
}

export function captureRequest(value: unknown): CaptureRequest {
  const input = record(value, 'capture request')
  return {
    mode: enumValue(input.mode, 'capture mode', [
      'region', 'window', 'display', 'fullscreen', 'lastRegion', 'scrolling'
    ] as const),
    delay: input.delay === undefined ? undefined : finite(input.delay, 'capture delay', 0, 60),
    displayId: optionalString(input.displayId, 'display id', 256),
    windowId: optionalString(input.windowId, 'window id', 512),
    silent: input.silent === undefined ? undefined : booleanValue(input.silent, 'silent')
  }
}

export function clipDocument(value: unknown): ClipDocument {
  const input = record(value, 'project')
  if (input.version !== 1) throw new TypeError('project version is not supported')
  stringValue(input.id, 'project id', 256)
  stringValue(input.title, 'project title', 240)
  imageDataUrl(input.image, 'project image')
  finite(input.imageWidth, 'project image width', 1, 200_000)
  finite(input.imageHeight, 'project image height', 1, 200_000)
  finite(input.scaleFactor, 'project scale factor', 0.01, 100)
  rectValue(input.crop, 'project crop')
  if (!Array.isArray(input.shapes) || input.shapes.length > 20_000) {
    throw new TypeError('project has too many shapes')
  }
  record(input.canvas, 'project canvas')
  const serialized = JSON.stringify(input)
  if (serialized.length > MAX_PROJECT_JSON) throw new TypeError('project is too large')
  return value as ClipDocument
}

export function saveImageRequest(value: unknown): SaveImageRequest {
  const input = record(value, 'save image request')
  return {
    dataUrl: imageDataUrl(input.dataUrl),
    format: enumValue(input.format, 'image format', ['png', 'jpg', 'webp'] as const),
    suggestedName: optionalString(input.suggestedName, 'suggested name', 240),
    saveAs: input.saveAs === undefined ? undefined : booleanValue(input.saveAs, 'save as'),
    project: input.project === undefined ? undefined : clipDocument(input.project)
  }
}

export function libraryQuery(value: unknown): LibraryQuery {
  const input = value === undefined ? {} : record(value, 'library query')
  return {
    search: optionalString(input.search, 'search', 1_000),
    tag: optionalString(input.tag, 'tag', 120),
    favorite: input.favorite === undefined ? undefined : booleanValue(input.favorite, 'favorite'),
    kind: input.kind === undefined
      ? undefined
      : enumValue(input.kind, 'library kind', ['image', 'video'] as const),
    limit: input.limit === undefined ? undefined : finite(input.limit, 'limit', 0, 1_000),
    offset: input.offset === undefined ? undefined : finite(input.offset, 'offset', 0, 10_000_000)
  }
}

export function libraryPatch(value: unknown): LibraryItemPatch {
  const input = record(value, 'library patch')
  const allowed = new Set(['title', 'tags', 'favorite', 'ocrText'])
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`library field ${key} cannot be changed`)
  }
  const patch: LibraryItemPatch = {}
  if (input.title !== undefined) patch.title = stringValue(input.title, 'title', 240)
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.length > 50) throw new TypeError('tags are invalid')
    patch.tags = input.tags.map((tag, index) => stringValue(tag, `tag ${index + 1}`, 120))
  }
  if (input.favorite !== undefined) patch.favorite = booleanValue(input.favorite, 'favorite')
  if (input.ocrText !== undefined) patch.ocrText = stringValue(input.ocrText, 'OCR text', 2_000_000)
  return patch
}

export function libraryAddPayload(value: unknown): {
  dataUrl: string
  title: string
  width: number
  height: number
  project?: ClipDocument
  ocrText?: string
  replaceId?: string
} {
  const input = record(value, 'library item')
  return {
    dataUrl: imageDataUrl(input.dataUrl),
    title: stringValue(input.title, 'library title', 240),
    width: finite(input.width, 'library width', 1, 200_000),
    height: finite(input.height, 'library height', 1, 200_000),
    project: input.project === undefined ? undefined : clipDocument(input.project),
    ocrText: optionalString(input.ocrText, 'OCR text', 2_000_000),
    replaceId: optionalString(input.replaceId, 'replacement id', 512)
  }
}

export function idValue(value: unknown, label = 'id'): string {
  return stringValue(value, label, 512)
}

export function idList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1_000) throw new TypeError('id list is invalid')
  return value.map((id, index) => idValue(id, `id ${index + 1}`))
}

export function recordingOptions(value: unknown): RecordingOptions {
  const input = record(value, 'recording options')
  const fps = finite(input.fps, 'recording fps', 15, 60)
  if (![15, 24, 30, 60].includes(fps)) throw new TypeError('recording fps is not supported')
  return {
    target: enumValue(input.target, 'recording target', ['display', 'region', 'window'] as const),
    autoZoom: booleanValue(input.autoZoom, 'auto zoom'),
    zoomLevel: finite(input.zoomLevel, 'zoom level', 1, 8),
    displayId: optionalString(input.displayId, 'display id', 256),
    windowId: optionalString(input.windowId, 'window id', 512),
    region: input.region === undefined ? undefined : rectValue(input.region, 'recording region'),
    fps: fps as RecordingOptions['fps'],
    microphone: booleanValue(input.microphone, 'microphone'),
    microphoneDeviceId: optionalString(input.microphoneDeviceId, 'microphone device id', 512),
    systemAudio: booleanValue(input.systemAudio, 'system audio'),
    webcam: booleanValue(input.webcam, 'webcam'),
    webcamDeviceId: optionalString(input.webcamDeviceId, 'webcam device id', 512),
    webcamPosition: enumValue(input.webcamPosition, 'webcam position', ['tl', 'tr', 'bl', 'br'] as const),
    webcamSize: finite(input.webcamSize, 'webcam size', 32, 2_000),
    countdown: finite(input.countdown, 'countdown', 0, 30)
  }
}

export function videoExportOptions(value: unknown): VideoExportOptions {
  const input = record(value, 'video export options')
  const startMs = input.startMs === undefined ? undefined : finite(input.startMs, 'trim start', 0, 86_400_000)
  const endMs = input.endMs === undefined ? undefined : finite(input.endMs, 'trim end', 0, 86_400_000)
  if (startMs !== undefined && endMs !== undefined && endMs <= startMs) {
    throw new TypeError('trim end must be after trim start')
  }
  return {
    format: enumValue(input.format, 'video format', ['mp4', 'gif', 'webm'] as const),
    quality: enumValue(input.quality, 'video quality', ['low', 'medium', 'high'] as const),
    startMs,
    endMs,
    fps: input.fps === undefined ? undefined : finite(input.fps, 'export fps', 1, 120),
    maxWidth: input.maxWidth === undefined ? undefined : finite(input.maxWidth, 'maximum width', 64, 16_384)
  }
}

export function recordingMeta(value: unknown): {
  width: number
  height: number
  durationMs: number
  posterDataUrl?: string
} {
  const input = record(value, 'recording metadata')
  return {
    width: finite(input.width, 'recording width', 1, 200_000),
    height: finite(input.height, 'recording height', 1, 200_000),
    durationMs: finite(input.durationMs, 'recording duration', 1, 86_400_000),
    posterDataUrl: input.posterDataUrl === undefined
      ? undefined
      : imageDataUrl(input.posterDataUrl, 'recording poster')
  }
}

export function recordingBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > MAX_RECORDING_BYTES) {
    throw new TypeError('recording payload is empty or too large')
  }
  return value
}

export function pathValue(value: unknown): string {
  return stringValue(value, 'file path', 32_768)
}

export function scaleFactorValue(value: unknown): number {
  return finite(value, 'scale factor', 0.01, 100)
}
