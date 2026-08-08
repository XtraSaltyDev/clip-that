import type {
  CanvasStyle,
  CaptureRequest,
  ClipDocument,
  Hotkeys,
  LibraryItemPatch,
  LibraryQuery,
  Settings,
  RecordingOptions,
  Rect,
  SaveImageRequest,
  Toast,
  VideoExportOptions
} from '@shared/types'

const MAX_IMAGE_DATA_URL = 256 * 1024 * 1024
const MAX_RECORDING_CHUNK_BYTES = 64 * 1024 * 1024
const MAX_PROJECT_JSON = 64 * 1024 * 1024

type UnknownRecord = Record<string, unknown>

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as UnknownRecord
}

function rejectUnknown(input: UnknownRecord, allowed: readonly string[], label: string): void {
  const keys = new Set(allowed)
  for (const key of Object.keys(input)) {
    if (!keys.has(key)) throw new TypeError(`${label} field ${key} is not supported`)
  }
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

export function numberValue(value: unknown, label: string, min: number, max: number): number {
  return finite(value, label, min, max)
}

export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be true or false`)
  return value
}

function enumValue<T extends string>(value: unknown, label: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new TypeError(`${label} is not supported`)
  }
  return value as T
}

function colorValue(value: unknown, label: string): string {
  const color = stringValue(value, label, 64)
  if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) {
    throw new TypeError(`${label} must be a six or eight digit hex colour`)
  }
  return color
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
  rejectUnknown(input, ['mode', 'delay', 'displayId', 'windowId', 'silent'], 'capture request')
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

export function overlaySelection(value: unknown): {
  displayId: string
  rect: Rect
  screenRect: Rect
  mode: 'region' | 'window' | 'display' | 'scrolling'
  windowId?: string
} {
  const input = record(value, 'overlay selection')
  rejectUnknown(input, ['displayId', 'rect', 'screenRect', 'mode', 'windowId'], 'overlay selection')
  return {
    displayId: stringValue(input.displayId, 'overlay display id', 256),
    rect: rectValue(input.rect, 'overlay pixel rectangle'),
    screenRect: rectValue(input.screenRect, 'overlay screen rectangle'),
    mode: enumValue(input.mode, 'overlay mode', ['region', 'window', 'display', 'scrolling'] as const),
    windowId: optionalString(input.windowId, 'overlay window id', 512)
  }
}

export function clipDocument(value: unknown): ClipDocument {
  const input = record(value, 'project')
  rejectUnknown(
    input,
    [
      'version', 'id', 'title', 'createdAt', 'updatedAt', 'image', 'imageWidth',
      'imageHeight', 'scaleFactor', 'crop', 'shapes', 'canvas', 'ocrText', 'tags'
    ],
    'project'
  )
  if (input.version !== 1) throw new TypeError('project version is not supported')
  stringValue(input.id, 'project id', 256)
  stringValue(input.title, 'project title', 240)
  finite(input.createdAt, 'project creation time', 0, Number.MAX_SAFE_INTEGER)
  finite(input.updatedAt, 'project update time', 0, Number.MAX_SAFE_INTEGER)
  imageDataUrl(input.image, 'project image')
  finite(input.imageWidth, 'project image width', 1, 200_000)
  finite(input.imageHeight, 'project image height', 1, 200_000)
  finite(input.scaleFactor, 'project scale factor', 0.01, 100)
  const crop = record(input.crop, 'project crop')
  rejectUnknown(crop, ['x', 'y', 'width', 'height', 'enabled'], 'project crop')
  rectValue(crop, 'project crop')
  booleanValue(crop.enabled, 'project crop enabled')
  if (!Array.isArray(input.shapes) || input.shapes.length > 20_000) {
    throw new TypeError('project has too many shapes')
  }
  const canvas = record(input.canvas, 'project canvas')
  canvasStyle(canvas, canvas as unknown as CanvasStyle)
  optionalString(input.ocrText, 'project OCR text', 2_000_000)
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.length > 50) throw new TypeError('project tags are invalid')
    input.tags.forEach((tag, index) => stringValue(tag, `project tag ${index + 1}`, 120))
  }
  const serialized = JSON.stringify(input)
  if (serialized.length > MAX_PROJECT_JSON) throw new TypeError('project is too large')
  return value as ClipDocument
}

export function saveImageRequest(value: unknown): SaveImageRequest {
  const input = record(value, 'save image request')
  rejectUnknown(input, ['dataUrl', 'format', 'suggestedName', 'saveAs', 'project'], 'save image request')
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
  rejectUnknown(input, ['search', 'tag', 'favorite', 'kind', 'limit', 'offset'], 'library query')
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
  const allowed = new Set(['title', 'tags', 'favorite', 'ocrText', 'videoEdit'])
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
  if (input.videoEdit !== undefined) {
    if (input.videoEdit === null) patch.videoEdit = null
    else {
      const draft = record(input.videoEdit, 'video edit draft')
      rejectUnknown(draft, ['startMs', 'endMs', 'format', 'quality', 'updatedAt'], 'video edit draft')
      const startMs = finite(draft.startMs, 'trim start', 0, 86_400_000)
      const endMs = finite(draft.endMs, 'trim end', 0, 86_400_000)
      if (endMs <= startMs) throw new TypeError('trim end must be after trim start')
      patch.videoEdit = {
        startMs,
        endMs,
        format: enumValue(draft.format, 'video format', ['mp4', 'webm'] as const),
        quality: enumValue(draft.quality, 'video quality', ['medium', 'high'] as const),
        updatedAt: finite(draft.updatedAt, 'video edit time', 0, 9_000_000_000_000_000)
      }
    }
  }
  return patch
}

function canvasStyle(value: unknown, current: CanvasStyle): CanvasStyle {
  const input = record(value, 'canvas preset')
  rejectUnknown(
    input,
    [
      'padding', 'background', 'backgroundColor', 'gradientFrom', 'gradientTo',
      'gradientAngle', 'backgroundImage', 'radius', 'shadowBlur', 'shadowOpacity',
      'shadowOffsetY', 'tiltX', 'tiltY', 'borderWidth', 'borderColor', 'frame',
      'frameTitle', 'aspect'
    ],
    'canvas preset'
  )
  const merged = { ...current, ...input }
  return {
    padding: finite(merged.padding, 'canvas padding', 0, 2_000),
    background: enumValue(merged.background, 'canvas background', ['none', 'solid', 'gradient', 'image', 'desktop'] as const),
    backgroundColor: colorValue(merged.backgroundColor, 'canvas background colour'),
    gradientFrom: colorValue(merged.gradientFrom, 'canvas gradient start'),
    gradientTo: colorValue(merged.gradientTo, 'canvas gradient end'),
    gradientAngle: finite(merged.gradientAngle, 'canvas gradient angle', 0, 360),
    backgroundImage: merged.backgroundImage === undefined
      ? undefined
      : imageDataUrl(merged.backgroundImage, 'canvas background image'),
    radius: finite(merged.radius, 'canvas radius', 0, 1_000),
    shadowBlur: finite(merged.shadowBlur, 'canvas shadow blur', 0, 2_000),
    shadowOpacity: finite(merged.shadowOpacity, 'canvas shadow opacity', 0, 1),
    shadowOffsetY: finite(merged.shadowOffsetY, 'canvas shadow offset', -2_000, 2_000),
    tiltX: finite(merged.tiltX, 'canvas tilt x', -30, 30),
    tiltY: finite(merged.tiltY, 'canvas tilt y', -30, 30),
    borderWidth: finite(merged.borderWidth, 'canvas border width', 0, 100),
    borderColor: colorValue(merged.borderColor, 'canvas border colour'),
    frame: enumValue(merged.frame, 'canvas frame', ['none', 'macos', 'windows'] as const),
    frameTitle: optionalString(merged.frameTitle, 'canvas frame title', 240),
    aspect: optionalString(merged.aspect, 'canvas aspect', 32)
  }
}

const HOTKEY_KEYS: Array<keyof Hotkeys> = [
  'captureRegion',
  'captureWindow',
  'captureFullscreen',
  'captureLastRegion',
  'captureScrolling',
  'startRecording',
  'stopRecording',
  'openLibrary',
  'grabText'
]

export function settingsPatch(value: unknown, current: Settings): Partial<Settings> {
  const input = record(value, 'settings patch')
  rejectUnknown(
    input,
    [
      'hotkeys', 'afterCapture', 'libraryOpenBehavior', 'pipeline', 'saveDirectory',
      'filenameTemplate', 'imageFormat', 'jpegQuality', 'copyOnSave', 'theme', 'accent',
      'launchAtLogin', 'showInTray', 'showInDock', 'autoOcr', 'defaultAnnotationColor',
      'defaultStrokeWidth', 'defaultFontSize', 'defaultFontFamily', 'recording',
      'canvasPreset', 'lastRegion', 'onboarded'
    ],
    'settings'
  )
  const patch: Partial<Settings> = {}
  if (input.hotkeys !== undefined) {
    const raw = record(input.hotkeys, 'hotkeys')
    rejectUnknown(raw, HOTKEY_KEYS, 'hotkeys')
    const next = { ...current.hotkeys }
    for (const key of HOTKEY_KEYS) {
      if (raw[key] !== undefined) next[key] = stringValue(raw[key], `hotkey ${key}`, 128)
    }
    patch.hotkeys = next
  }
  if (input.afterCapture !== undefined) {
    patch.afterCapture = enumValue(input.afterCapture, 'after capture action', [
      'quickAccess', 'editor', 'clipboard', 'file', 'clipboardAndFile', 'pipeline'
    ] as const)
  }
  if (input.libraryOpenBehavior !== undefined) {
    patch.libraryOpenBehavior = enumValue(input.libraryOpenBehavior, 'library open behavior', ['ask', 'existing', 'new'] as const)
  }
  if (input.pipeline !== undefined) {
    const raw = record(input.pipeline, 'pipeline')
    rejectUnknown(raw, ['copy', 'save', 'pin', 'edit', 'command'], 'pipeline')
    const merged = { ...current.pipeline, ...raw }
    patch.pipeline = {
      copy: booleanValue(merged.copy, 'pipeline copy'),
      save: booleanValue(merged.save, 'pipeline save'),
      pin: booleanValue(merged.pin, 'pipeline pin'),
      edit: booleanValue(merged.edit, 'pipeline edit'),
      command: stringValue(merged.command, 'pipeline command', 10_000)
    }
  }
  if (input.saveDirectory !== undefined) patch.saveDirectory = pathValue(input.saveDirectory)
  if (input.filenameTemplate !== undefined) patch.filenameTemplate = stringValue(input.filenameTemplate, 'filename template', 240)
  if (input.imageFormat !== undefined) patch.imageFormat = enumValue(input.imageFormat, 'image format', ['png', 'jpg', 'webp'] as const)
  if (input.jpegQuality !== undefined) patch.jpegQuality = finite(input.jpegQuality, 'JPEG quality', 1, 100)
  if (input.copyOnSave !== undefined) patch.copyOnSave = booleanValue(input.copyOnSave, 'copy on save')
  if (input.theme !== undefined) patch.theme = enumValue(input.theme, 'theme', ['system', 'light', 'dark'] as const)
  if (input.accent !== undefined) patch.accent = colorValue(input.accent, 'accent')
  if (input.launchAtLogin !== undefined) patch.launchAtLogin = booleanValue(input.launchAtLogin, 'launch at login')
  if (input.showInTray !== undefined) patch.showInTray = booleanValue(input.showInTray, 'show in menu bar')
  if (input.showInDock !== undefined) patch.showInDock = booleanValue(input.showInDock, 'show in Dock')
  if (input.autoOcr !== undefined) patch.autoOcr = booleanValue(input.autoOcr, 'automatic OCR')
  if (input.defaultAnnotationColor !== undefined) patch.defaultAnnotationColor = colorValue(input.defaultAnnotationColor, 'annotation colour')
  if (input.defaultStrokeWidth !== undefined) patch.defaultStrokeWidth = finite(input.defaultStrokeWidth, 'stroke width', 1, 100)
  if (input.defaultFontSize !== undefined) patch.defaultFontSize = finite(input.defaultFontSize, 'font size', 6, 500)
  if (input.defaultFontFamily !== undefined) patch.defaultFontFamily = stringValue(input.defaultFontFamily, 'font family', 240)
  if (input.recording !== undefined) patch.recording = recordingOptions({ ...current.recording, ...record(input.recording, 'recording settings') })
  if (input.canvasPreset !== undefined) patch.canvasPreset = canvasStyle(input.canvasPreset, current.canvasPreset)
  if (input.lastRegion !== undefined) {
    const raw = record(input.lastRegion, 'last region')
    rejectUnknown(raw, ['x', 'y', 'width', 'height', 'displayId'], 'last region')
    patch.lastRegion = {
      ...rectValue(raw, 'last region'),
      displayId: optionalString(raw.displayId, 'last region display id', 256)
    }
  }
  if (input.onboarded !== undefined) patch.onboarded = booleanValue(input.onboarded, 'onboarded')
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
  rejectUnknown(
    input,
    ['dataUrl', 'title', 'width', 'height', 'project', 'ocrText', 'replaceId'],
    'library item'
  )
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
  rejectUnknown(
    input,
    [
      'target', 'autoZoom', 'zoomLevel', 'displayId', 'windowId', 'region', 'fps',
      'microphone', 'microphoneDeviceId', 'systemAudio', 'webcam', 'webcamDeviceId',
      'webcamPosition', 'webcamSize', 'countdown'
    ],
    'recording options'
  )
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
  rejectUnknown(input, ['format', 'quality', 'startMs', 'endMs', 'fps', 'maxWidth'], 'video export options')
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
  rejectUnknown(input, ['width', 'height', 'durationMs', 'posterDataUrl'], 'recording metadata')
  return {
    width: finite(input.width, 'recording width', 1, 200_000),
    height: finite(input.height, 'recording height', 1, 200_000),
    durationMs: finite(input.durationMs, 'recording duration', 1, 86_400_000),
    posterDataUrl: input.posterDataUrl === undefined
      ? undefined
      : imageDataUrl(input.posterDataUrl, 'recording poster')
  }
}

export function recordingChunkBytes(value: unknown): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > MAX_RECORDING_CHUNK_BYTES
  ) {
    throw new TypeError('recording chunk is empty or too large')
  }
  return value
}

export function byteArray(value: unknown, label: string, maxBytes: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > maxBytes) {
    throw new TypeError(`${label} is empty or too large`)
  }
  return value
}

export function recordingSequence(value: unknown): number {
  const sequence = finite(value, 'recording chunk sequence', 0, 10_000_000)
  if (!Number.isInteger(sequence)) throw new TypeError('recording chunk sequence must be an integer')
  return sequence
}

export function recordingMimeType(value: unknown): string {
  const mimeType = stringValue(value, 'recording MIME type', 128)
  if (!/^video\/webm(?:;|$)/i.test(mimeType)) {
    throw new TypeError('recording MIME type must be WebM')
  }
  return mimeType
}

export function recordingFinalizeMeta(value: unknown): {
  width: number
  height: number
  mimeType: string
} {
  const input = record(value, 'recording finalization metadata')
  rejectUnknown(input, ['width', 'height', 'mimeType'], 'recording finalization metadata')
  return {
    width: finite(input.width, 'recording width', 1, 200_000),
    height: finite(input.height, 'recording height', 1, 200_000),
    mimeType: recordingMimeType(input.mimeType)
  }
}

export function recordingFailure(value: unknown): string {
  return stringValue(value, 'recording failure', 2_000)
}

export function pathValue(value: unknown): string {
  return stringValue(value, 'file path', 32_768)
}

export function scaleFactorValue(value: unknown): number {
  return finite(value, 'scale factor', 0.01, 100)
}

export function permissionKind(value: unknown): 'microphone' | 'camera' | 'screen' {
  return enumValue(value, 'permission kind', ['microphone', 'camera', 'screen'] as const)
}

export function windowAction(value: unknown): 'minimize' | 'maximize' | 'close' | 'library' | 'settings' | 'record' {
  return enumValue(value, 'window action', ['minimize', 'maximize', 'close', 'library', 'settings', 'record'] as const)
}

export function quickAction(value: unknown): 'copy' | 'save' | 'pin' | 'edit' {
  return enumValue(value, 'quick action', ['copy', 'save', 'pin', 'edit'] as const)
}

export function externalUrl(value: unknown): string {
  const url = stringValue(value, 'external URL', 8_192)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new TypeError('external URL is invalid')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('external URL must use HTTP or HTTPS')
  }
  return parsed.toString()
}

export function toastValue(value: unknown): Toast {
  const input = record(value, 'toast')
  rejectUnknown(input, ['kind', 'message', 'detail'], 'toast')
  return {
    kind: enumValue(input.kind, 'toast kind', ['info', 'success', 'error'] as const),
    message: stringValue(input.message, 'toast message', 500),
    detail: optionalString(input.detail, 'toast detail', 2_000)
  }
}

export function ocrResponse(value: unknown): { id: string; text: string } {
  const input = record(value, 'OCR response')
  rejectUnknown(input, ['id', 'text'], 'OCR response')
  return {
    id: stringValue(input.id, 'OCR response id', 256),
    text: stringValue(input.text, 'OCR response text', 4_000_000)
  }
}
