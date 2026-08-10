/**
 * Types shared by main, preload and every renderer entry.
 * This file must stay dependency-free so it can be imported from any process.
 */

/* ------------------------------------------------------------------ *
 * Displays & capture
 * ------------------------------------------------------------------ */

export interface DisplayInfo {
  id: string
  /** Logical (DIP) bounds in the virtual desktop coordinate space. */
  bounds: Rect
  workArea: Rect
  scaleFactor: number
  rotation: number
  internal: boolean
  primary: boolean
  label: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowInfo {
  id: string
  title: string
  appName: string
  /** Preview thumbnail as a data URL, for the window picker. */
  thumbnail?: string
  /** App icon as a data URL, when the platform provides one. */
  icon?: string
  /** Logical bounds; absent on backends that cannot report geometry. */
  bounds?: Rect
  displayId?: string
}

export type CaptureMode =
  | 'region'
  | 'window'
  | 'display'
  | 'fullscreen'
  | 'lastRegion'
  | 'scrolling'

export interface CaptureRequest {
  mode: CaptureMode
  /** Seconds to wait before the shutter fires. */
  delay?: number
  /** For `display` mode. */
  displayId?: string
  /** For `window` mode. */
  windowId?: string
  /** Skip the editor and go straight to the configured after-capture action. */
  silent?: boolean
}

/** A raw screen snapshot, one per physical display. */
export interface DisplaySnapshot {
  displayId: string
  /** Data URL of the PNG snapshot at native pixel resolution. */
  dataUrl: string
  /** Logical bounds of the display in the virtual desktop. */
  bounds: Rect
  scaleFactor: number
  pixelWidth: number
  pixelHeight: number
}

/** Whether an editor that was visible when capture began is included in the scene. */
export interface CaptureEditorVisibility {
  available: boolean
  visible: boolean
}

/** A live overlay update after the user toggles editor visibility. */
export interface CaptureOverlayUpdate {
  editorVisibility: CaptureEditorVisibility
  snapshot?: DisplaySnapshot
}

/** Result handed to the editor after any capture. */
export interface CaptureResult {
  id: string
  /** PNG data URL at native resolution. */
  dataUrl: string
  width: number
  height: number
  scaleFactor: number
  source: CaptureMode
  createdAt: number
  /** Where on the virtual desktop this came from, when known. */
  origin?: Rect
  title?: string
}

/** Geometry the scrolling HUD needs to crop the selected region from a live display stream. */
export interface ScrollCaptureConfig {
  rect: Rect
  displayWidth: number
  displayHeight: number
  intervalMs: number
}

/* ------------------------------------------------------------------ *
 * Editor document model — non-destructive scene graph
 * ------------------------------------------------------------------ */

export type ToolId =
  | 'select'
  | 'crop'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'highlighter'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'callout'
  | 'step'
  | 'blur'
  | 'pixelate'
  | 'redact'
  | 'spotlight'
  | 'magnify'
  | 'measure'

export interface BaseShape {
  id: string
  type: ToolId
  /** Draw order; higher is on top. */
  z: number
  locked?: boolean
  hidden?: boolean
  opacity?: number
  rotation?: number
}

export interface StrokeStyle {
  stroke: string
  strokeWidth: number
  dash?: number[]
}

export interface FillStyle {
  fill?: string
  fillOpacity?: number
}

export interface ShadowStyle {
  shadow?: boolean
  shadowColor?: string
  shadowBlur?: number
  shadowOffsetX?: number
  shadowOffsetY?: number
}

export interface ArrowShape extends BaseShape, StrokeStyle, ShadowStyle {
  type: 'arrow' | 'line' | 'measure'
  points: number[] // [x1,y1,x2,y2] — or a polyline for multi-segment
  /** Arrowhead sizing multiplier relative to strokeWidth. */
  headScale?: number
  startHead?: boolean
  endHead?: boolean
  /** Quadratic control point offset perpendicular to the line, in px. */
  curve?: number
}

export interface FreehandShape extends BaseShape, StrokeStyle {
  type: 'pen' | 'highlighter'
  points: number[] // flat [x,y,...]
  /** Highlighter uses multiply blending and a fat soft stroke. */
  smoothing?: number
}

export interface BoxShape extends BaseShape, StrokeStyle, FillStyle, ShadowStyle {
  type: 'rect' | 'ellipse' | 'blur' | 'pixelate' | 'redact' | 'spotlight' | 'magnify'
  x: number
  y: number
  width: number
  height: number
  cornerRadius?: number
  /** For blur/pixelate/magnify. */
  intensity?: number
  /** Spotlight dims everything outside the box by this amount. */
  dim?: number
}

export interface TextShape extends BaseShape, FillStyle, ShadowStyle {
  type: 'text' | 'callout'
  x: number
  y: number
  width: number
  height?: number
  text: string
  fontFamily: string
  fontSize: number
  fontStyle?: string
  align?: 'left' | 'center' | 'right'
  color: string
  background?: string
  padding?: number
  cornerRadius?: number
  /** Callout tail target, relative to the shape origin. */
  tail?: { x: number; y: number }
  stroke?: string
  strokeWidth?: number
}

export interface StepShape extends BaseShape, ShadowStyle {
  type: 'step'
  x: number
  y: number
  radius: number
  /** Rendered number; assigned automatically but user-editable. */
  index: number
  fill: string
  color: string
  fontSize: number
  shape?: 'circle' | 'square' | 'diamond'
}

export type Shape = ArrowShape | FreehandShape | BoxShape | TextShape | StepShape

/* ---- Beautify / canvas presentation ---- */

export type BackgroundKind = 'none' | 'solid' | 'gradient' | 'image' | 'desktop'

export interface CanvasStyle {
  padding: number
  background: BackgroundKind
  backgroundColor: string
  gradientFrom: string
  gradientTo: string
  gradientAngle: number
  backgroundImage?: string
  /** Screenshot corner radius. */
  radius: number
  shadowBlur: number
  shadowOpacity: number
  shadowOffsetY: number
  /** Perspective tilt in degrees, -30..30. */
  tiltX: number
  tiltY: number
  /** Omitted on legacy version-1 documents that use the original axis mapping. */
  tiltSemantics?: 'legacy' | 'visible-axis'
  /** Inset hairline border around the screenshot. */
  borderWidth: number
  borderColor: string
  /** Fake window chrome drawn above the screenshot. */
  frame: 'none' | 'macos' | 'windows'
  frameTitle?: string
  /** Force an output aspect ratio by growing the padding box. */
  aspect?: string
}

export interface CropRect extends Rect {
  enabled: boolean
}

export interface ClipDocument {
  version: 1
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** Base image as a PNG data URL at native resolution. */
  image: string
  imageWidth: number
  imageHeight: number
  scaleFactor: number
  crop: CropRect
  shapes: Shape[]
  canvas: CanvasStyle
  /** OCR text, cached for search. */
  ocrText?: string
  tags?: string[]
  /** External still path last chosen for this document, when one exists. */
  exportPath?: string
}

/* ------------------------------------------------------------------ *
 * Library
 * ------------------------------------------------------------------ */

export interface LibraryItem {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  kind: 'image' | 'video'
  width: number
  height: number
  /** Absolute path of the flattened PNG/MP4. */
  filePath: string
  /** Absolute path of the editable .clipthat project, images only. */
  projectPath?: string
  /** External still path last chosen for this item, when one exists. */
  exportPath?: string
  thumbnail: string
  tags: string[]
  favorite: boolean
  ocrText?: string
  durationMs?: number
  videoEdit?: VideoEditDraft
  byteSize: number
  /** Stable source marker for imports; never an absolute source path. */
  importedFrom?: 'snagit'
  /** Hash of the source bytes used for exact duplicate detection. */
  contentHash?: string
}

export interface VideoEditDraft {
  startMs: number
  endMs: number
  format: 'mp4' | 'webm'
  quality: 'medium' | 'high'
  updatedAt: number
}

/** The only Library fields a renderer is allowed to edit. Internal paths and identity stay main-owned. */
export interface LibraryItemPatch {
  title?: string
  exportPath?: string
  tags?: string[]
  favorite?: boolean
  ocrText?: string
  videoEdit?: VideoEditDraft | null
}

export interface LibraryHealth {
  status: 'ok' | 'warning' | 'error'
  message: string
  detail?: string
  recoveredItems?: number
}

export interface LibraryQuery {
  search?: string
  tag?: string
  favorite?: boolean
  kind?: 'image' | 'video'
  limit?: number
  offset?: number
}

export type SnagitImportCategory =
  | 'supported'
  | 'duplicates'
  | 'nativeProjects'
  | 'unsupported'
  | 'unreadable'

export interface SnagitImportPreview {
  planId: string
  rootName: string
  counts: Record<SnagitImportCategory, number>
  bytes: Record<SnagitImportCategory, number>
  totalFiles: number
  totalBytes: number
  importableFiles: number
  importableBytes: number
  samples: Record<SnagitImportCategory, string[]>
  limitReached?: string
}

export interface SnagitImportProgress {
  planId: string
  state: 'importing' | 'completed' | 'cancelled'
  completed: number
  total: number
  imported: number
  skipped: number
  failed: number
  percent: number
  currentTitle?: string
}

export interface SnagitImportSummary {
  state: 'completed' | 'cancelled'
  imported: number
  skipped: number
  failed: number
  unsupported: number
  nativeProjects: number
  unreadable: number
}

/* ------------------------------------------------------------------ *
 * Recording
 * ------------------------------------------------------------------ */

export interface RecordingOptions {
  /** 'display' records a whole screen, 'region' crops to a rect, 'window' picks a window. */
  target: 'display' | 'region' | 'window'
  /** Smoothed camera that follows the cursor, Screen Studio style. */
  autoZoom: boolean
  /** Magnification while auto-zoom is engaged. */
  zoomLevel: number
  displayId?: string
  windowId?: string
  region?: Rect
  fps: 15 | 24 | 30 | 60
  microphone: boolean
  microphoneDeviceId?: string
  systemAudio: boolean
  webcam: boolean
  webcamDeviceId?: string
  webcamPosition: 'tl' | 'tr' | 'bl' | 'br'
  /** Diameter of the webcam bubble, in output pixels. */
  webcamSize: number
  countdown: number
}

export type RecordingState = 'idle' | 'countdown' | 'recording' | 'paused' | 'encoding'

export interface RecordingStatus {
  state: RecordingState
  elapsedMs: number
  options?: RecordingOptions
  /** Main-process-owned durable capture session, present while a recording is active. */
  sessionId?: string
}

export type RecoverableRecordingState = 'recording' | 'ready' | 'failed'

/** A raw WebM kept outside renderer memory until it is exported or explicitly discarded. */
export interface RecoverableRecording {
  id: string
  state: RecoverableRecordingState
  createdAt: number
  updatedAt: number
  rawPath: string
  mimeType: string
  byteSize: number
  chunkCount: number
  options: RecordingOptions
  width?: number
  height?: number
  durationMs?: number
  failure?: string
}

export type VideoFormat = 'mp4' | 'gif' | 'webm'

export interface VideoExportOptions {
  format: VideoFormat
  /** Trim window in milliseconds. */
  startMs?: number
  endMs?: number
  fps?: number
  /** Max output width; height follows aspect. */
  maxWidth?: number
  quality: 'low' | 'medium' | 'high'
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export type AfterCapture =
  | 'quickAccess'
  | 'editor'
  | 'clipboard'
  | 'file'
  | 'clipboardAndFile'
  | 'pipeline'

/** What opening an image from the full Library does when an editor is already open. */
export type LibraryOpenBehavior = 'ask' | 'existing' | 'new'

/** One configurable chain of things that happen to a capture, ShareX style. */
export interface Pipeline {
  copy: boolean
  save: boolean
  pin: boolean
  edit: boolean
  /** Shell command run after save; `{file}` expands to the saved path. */
  command: string
}

export interface Hotkeys {
  captureRegion: string
  captureWindow: string
  captureFullscreen: string
  captureLastRegion: string
  captureScrolling: string
  startRecording: string
  stopRecording: string
  openLibrary: string
  grabText: string
}

export interface Settings {
  hotkeys: Hotkeys
  afterCapture: AfterCapture
  libraryOpenBehavior: LibraryOpenBehavior
  pipeline: Pipeline
  saveDirectory: string
  filenameTemplate: string
  imageFormat: 'png' | 'jpg' | 'webp'
  jpegQuality: number
  copyOnSave: boolean
  theme: 'system' | 'light' | 'dark'
  accent: string
  launchAtLogin: boolean
  showInTray: boolean
  showInDock: boolean
  autoOcr: boolean
  defaultAnnotationColor: string
  defaultStrokeWidth: number
  defaultFontSize: number
  defaultFontFamily: string
  recording: RecordingOptions
  canvasPreset: CanvasStyle
  /** Remembered region for "repeat last region". */
  lastRegion?: Rect & { displayId?: string }
  onboarded: boolean
}

/* ------------------------------------------------------------------ *
 * Bundled release notes
 * ------------------------------------------------------------------ */

export interface ReleaseNote {
  title: string
  body: string
}

export interface ReleaseNotes {
  version: string
  title: string
  summary: string
  items: readonly ReleaseNote[]
}

export interface ReleaseNotesStatus {
  currentVersion: string
  lastSeenVersion: string | null
  notes: ReleaseNotes | null
  unread: boolean
}

/* ------------------------------------------------------------------ *
 * Internal updates
 * ------------------------------------------------------------------ */

export type AppUpdateStatus =
  | {
      state: 'unsupported'
      currentVersion: string
    }
  | {
      state: 'current'
      currentVersion: string
      latestVersion: string
      checkedAt: string
    }
  | {
      state: 'available'
      currentVersion: string
      latestVersion: string
      publishedAt: string
      size: number
      checkedAt: string
    }
  | {
      state: 'downloading'
      currentVersion: string
      latestVersion: string
      percent: number
      transferred: number
      total: number
      bytesPerSecond: number
    }
  | {
      state: 'ready'
      currentVersion: string
      latestVersion: string
      downloadedAt: string
    }
  | {
      state: 'unavailable'
      currentVersion: string
      reason: 'network' | 'trust' | 'invalid-response'
      checkedAt: string
    }

export interface AppUpdateDownloadResult {
  ok: boolean
  state?: 'ready' | 'browser'
  error?: string
}

export interface AppUpdateInstallResult {
  ok: boolean
  error?: string
}

/* ------------------------------------------------------------------ *
 * OCR & redaction
 * ------------------------------------------------------------------ */

export interface OcrWord {
  text: string
  confidence: number
  bbox: Rect
}

export interface OcrResult {
  text: string
  words: OcrWord[]
}

export type SensitiveKind =
  | 'email'
  | 'ipv4'
  | 'creditCard'
  | 'phone'
  | 'jwt'
  | 'apiKey'
  | 'ssn'

export interface SensitiveMatch {
  kind: SensitiveKind
  text: string
  bbox: Rect
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export interface SaveImageRequest {
  /** PNG/JPEG data URL of the flattened result. */
  dataUrl: string
  format: 'png' | 'jpg' | 'webp'
  suggestedName?: string
  /** Ask with a dialog instead of using the default directory. */
  saveAs?: boolean
  /** Existing external still to overwrite when saving without a dialog. */
  targetPath?: string
  /** Persist the editable project alongside the image. */
  project?: ClipDocument
}

export interface SaveResult {
  ok: boolean
  filePath?: string
  /** Base name of the written still without its extension. */
  title?: string
  canceled?: boolean
  error?: string
}

export interface Toast {
  kind: 'info' | 'success' | 'error'
  message: string
  detail?: string
}
