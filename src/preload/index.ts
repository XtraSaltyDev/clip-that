import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppUpdateDownloadResult,
  AppUpdateInstallResult,
  AppUpdateStatus,
  CaptureEditorVisibility,
  CaptureOverlayUpdate,
  CaptureRequest,
  CaptureResult,
  ClipDocument,
  DisplayInfo,
  EditorContextMenuAction,
  EditorContextMenuRequest,
  LibraryItem,
  LibraryItemView,
  LibraryHealth,
  LibraryItemPatch,
  LibraryQuery,
  GuideDocument,
  GuideExportFormat,
  GuideExportResult,
  GuideSummary,
  OcrResult,
  RecoverableRecording,
  RecordingOptions,
  RecordingPreflight,
  RecordingMediaCapabilities,
  RecordingStatus,
  PlatformCapability,
  ReleaseNotesStatus,
  SaveImageRequest,
  SaveResult,
  SnagitImportPreview,
  SnagitImportProgress,
  SnagitImportSummary,
  ScrollCaptureConfig,
  Settings,
  Shape,
  Toast,
  VideoExportOptions,
  WindowInfo
} from '@shared/types'

/** Subscribe helper that always returns an unsubscribe function. */
function on<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  capture: {
    start: (req: CaptureRequest): Promise<CaptureResult | null> =>
      ipcRenderer.invoke(IPC.captureStart, req),
    displays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IPC.captureDisplays),
    windows: (): Promise<WindowInfo[]> => ipcRenderer.invoke(IPC.captureWindows),
    windowPreview: (windowId: string): Promise<string | undefined> =>
      ipcRenderer.invoke(IPC.captureWindowPreview, windowId),
    windowInfo: (windowId: string): Promise<WindowInfo | undefined> =>
      ipcRenderer.invoke(IPC.captureWindowInfo, windowId),
    fromClipboard: (): Promise<CaptureResult | null> => ipcRenderer.invoke(IPC.captureClipboard),
    scrollConfig: (): Promise<ScrollCaptureConfig | null> =>
      ipcRenderer.invoke(IPC.captureScrollConfig),
    submitScrollFrame: (bytes: Uint8Array) => ipcRenderer.send(IPC.captureScrollFrame, bytes),
    useScrollFallback: (reason: string) => ipcRenderer.send(IPC.captureScrollFallback, reason),
    finishScrolling: (): Promise<CaptureResult | null> =>
      ipcRenderer.invoke(IPC.captureScrollStitch),
    /* overlay-only */
    submitSelection: (selection: unknown) => ipcRenderer.send(IPC.captureRegionResult, selection),
    cancel: () => ipcRenderer.send(IPC.captureCancel),
    setEditorsVisible: (visible: boolean): Promise<CaptureEditorVisibility> =>
      ipcRenderer.invoke(IPC.captureEditorVisibility, visible),
    onOverlayInit: (handler: (payload: unknown) => void) => on(IPC.captureOverlayInit, handler),
    onOverlayUpdate: (handler: (payload: CaptureOverlayUpdate) => void) =>
      on(IPC.captureOverlayUpdate, handler),
    onOverlayRelease: (handler: () => void) => on(IPC.captureOverlayRelease, handler),
    onScrollFrameCount: (handler: (count: number) => void) =>
      on(IPC.captureScrollFrameCount, handler)
  },

  editor: {
    /** Pull the document this window was opened with. */
    load: (): Promise<ClipDocument | null> => ipcRenderer.invoke(IPC.editorLoad),
    loadVideo: (): Promise<LibraryItem | null> => ipcRenderer.invoke(IPC.editorLoadVideo),
    onDocument: (handler: (doc: ClipDocument) => void) => on(IPC.editorDocument, handler),
    onVideo: (handler: (item: LibraryItem) => void) => on(IPC.editorVideo, handler),
    switchLibraryItem: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.editorSwitchLibraryItem, id),
    open: (doc: ClipDocument): Promise<boolean> => ipcRenderer.invoke(IPC.editorOpen, doc),
    close: () => ipcRenderer.send(IPC.editorClose),
    closeReady: (): Promise<boolean> => ipcRenderer.invoke(IPC.editorCloseReady),
    confirmClose: (allow: boolean): Promise<boolean> =>
      ipcRenderer.invoke(IPC.editorConfirmClose, allow),
    contextMenu: (request: EditorContextMenuRequest): Promise<EditorContextMenuAction | null> =>
      ipcRenderer.invoke(IPC.editorContextMenu, request),
    copyAnnotations: (shapes: Shape[]): Promise<number> =>
      ipcRenderer.invoke(IPC.editorAnnotationClipboardWrite, shapes),
    readAnnotations: (): Promise<Shape[]> => ipcRenderer.invoke(IPC.editorAnnotationClipboardRead),
    guideContext: (): Promise<{ guideId: string; stepId: string } | null> =>
      ipcRenderer.invoke(IPC.guideEditorContext),
    onCloseRequested: (handler: () => void) => on(IPC.editorCloseRequested, handler)
  },

  exports: {
    saveImage: (req: SaveImageRequest): Promise<SaveResult> =>
      ipcRenderer.invoke(IPC.saveImage, req),
    copyImage: (dataUrl: string): Promise<boolean> => ipcRenderer.invoke(IPC.copyImage, dataUrl),
    pdf: (dataUrl: string, name?: string): Promise<SaveResult> =>
      ipcRenderer.invoke(IPC.exportPdf, dataUrl, name),
    saveProject: (doc: ClipDocument, saveAs = true): Promise<SaveResult> =>
      ipcRenderer.invoke(IPC.saveProject, doc, saveAs),
    openProject: (): Promise<ClipDocument | null> => ipcRenderer.invoke(IPC.openProject),
    startDrag: (dataUrl: string, name: string): Promise<void> =>
      ipcRenderer.invoke(IPC.startDrag, dataUrl, name),
    reveal: (filePath: string): Promise<void> => ipcRenderer.invoke(IPC.revealFile, filePath),
    openFile: (filePath: string): Promise<string> => ipcRenderer.invoke(IPC.openFile, filePath)
  },

  library: {
    list: (query: LibraryQuery = {}): Promise<LibraryItemView[]> =>
      ipcRenderer.invoke(IPC.libraryList, query),
    tags: (): Promise<string[]> => ipcRenderer.invoke(IPC.libraryTags),
    add: (payload: {
      dataUrl: string
      title: string
      width: number
      height: number
      project?: ClipDocument
      ocrText?: string
      replaceId?: string
    }): Promise<LibraryItem> => ipcRenderer.invoke(IPC.libraryAdd, payload),
    update: (id: string, patch: LibraryItemPatch): Promise<LibraryItem | undefined> =>
      ipcRenderer.invoke(IPC.libraryUpdate, id, patch),
    remove: (ids: string[]): Promise<boolean> => ipcRenderer.invoke(IPC.libraryDelete, ids),
    open: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.libraryOpen, id),
    loadProject: (id: string): Promise<ClipDocument | null> =>
      ipcRenderer.invoke(IPC.libraryLoadProject, id),
    exportVideo: (
      id: string,
      options: VideoExportOptions,
      posterDataUrl?: string
    ): Promise<LibraryItem> =>
      ipcRenderer.invoke(IPC.libraryExportVideo, id, options, posterDataUrl),
    cancelVideoExport: (): Promise<boolean> => ipcRenderer.invoke(IPC.libraryCancelVideoExport),
    scanSnagit: (): Promise<SnagitImportPreview | null> =>
      ipcRenderer.invoke(IPC.librarySnagitScan),
    importSnagit: (planId: string): Promise<SnagitImportSummary> =>
      ipcRenderer.invoke(IPC.librarySnagitImport, planId),
    cancelSnagit: (planId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.librarySnagitCancel, planId),
    onSnagitProgress: (handler: (progress: SnagitImportProgress) => void) =>
      on(IPC.librarySnagitProgress, handler),
    health: (): Promise<LibraryHealth> => ipcRenderer.invoke(IPC.libraryHealth),
    onChanged: (handler: () => void) => on(IPC.libraryChanged, handler),
    onIssue: (handler: (health: LibraryHealth) => void) => on(IPC.libraryIssue, handler),
    /** Turn an absolute library path into a URL the renderer may load. */
    fileUrl: (filePath: string) => `clipthat://file/${encodeURIComponent(filePath)}`
  },

  guides: {
    list: (search = ''): Promise<GuideSummary[]> => ipcRenderer.invoke(IPC.guideList, search),
    create: (title = 'Untitled guide'): Promise<GuideDocument> =>
      ipcRenderer.invoke(IPC.guideCreate, title),
    get: (id: string): Promise<GuideDocument | null> => ipcRenderer.invoke(IPC.guideGet, id),
    save: (guide: GuideDocument): Promise<GuideDocument> =>
      ipcRenderer.invoke(IPC.guideSave, guide),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.guideDelete, id),
    capture: (
      id: string,
      mode: Exclude<CaptureRequest['mode'], 'scrolling'> = 'region'
    ): Promise<GuideDocument | null> => ipcRenderer.invoke(IPC.guideCapture, id, mode),
    recapture: (
      guideId: string,
      stepId: string,
      mode: Exclude<CaptureRequest['mode'], 'scrolling'> = 'region'
    ): Promise<GuideDocument | null> =>
      ipcRenderer.invoke(IPC.guideRecapture, guideId, stepId, mode),
    importStep: (id: string): Promise<GuideDocument | null> =>
      ipcRenderer.invoke(IPC.guideImportStep, id),
    addExisting: (id: string, project: ClipDocument): Promise<GuideDocument> =>
      ipcRenderer.invoke(IPC.guideAddExisting, id, project),
    editStep: (guideId: string, stepId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.guideEditStep, guideId, stepId),
    saveEditedStep: (project: ClipDocument, renderedImage: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.guideSaveEditedStep, project, renderedImage),
    export: (id: string, format: GuideExportFormat): Promise<GuideExportResult> =>
      ipcRenderer.invoke(IPC.guideExport, id, format),
    setActive: (id: string | null): Promise<boolean> => ipcRenderer.invoke(IPC.guideSetActive, id),
    onChanged: (handler: (payload: { guideId: string }) => void) => on(IPC.guideChanged, handler),
    onHotkeyCapture: (
      handler: (payload: { guideId: string; ok: boolean; error?: string }) => void
    ) => on(IPC.guideHotkeyCapture, handler)
  },

  recording: {
    mediaCapabilities: (): Promise<RecordingMediaCapabilities> =>
      ipcRenderer.invoke(IPC.recordMediaCapabilities),
    sources: (): Promise<{
      displays: DisplayInfo[]
      windows: WindowInfo[]
      systemAudioSupported: boolean
      media: {
        ffmpeg: boolean
        ffprobe: boolean
        encoders: string[]
        mp4: boolean
        webm: boolean
        gif: boolean
      }
      capabilities: PlatformCapability[]
    }> => ipcRenderer.invoke(IPC.recordSources),
    selectRegion: (): Promise<{
      displayId: string
      region: import('@shared/types').Rect
      screenRect: import('@shared/types').Rect
    } | null> => ipcRenderer.invoke(IPC.recordSelectRegion),
    preflight: (options: RecordingOptions): Promise<RecordingPreflight> =>
      ipcRenderer.invoke(IPC.recordPreflight, options),
    configure: (options: RecordingOptions): Promise<RecordingOptions> =>
      ipcRenderer.invoke(IPC.recordConfigure, options),
    captureSource: (): Promise<string> => ipcRenderer.invoke(IPC.recordCaptureSource),
    start: (options: RecordingOptions): Promise<RecordingStatus> =>
      ipcRenderer.invoke(IPC.recordStart, options),
    started: (): Promise<RecordingStatus> => ipcRenderer.invoke(IPC.recordStarted),
    pause: (): Promise<RecordingStatus> => ipcRenderer.invoke(IPC.recordPause),
    resume: (): Promise<RecordingStatus> => ipcRenderer.invoke(IPC.recordResume),
    stop: (): Promise<RecordingStatus> => ipcRenderer.invoke(IPC.recordStop),
    cancel: (): Promise<RecordingStatus> => ipcRenderer.invoke(IPC.recordCancel),
    status: (): Promise<RecordingStatus> => ipcRenderer.invoke(IPC.recordStatus),
    appendChunk: (
      sessionId: string,
      sequence: number,
      bytes: Uint8Array,
      mimeType: string
    ): Promise<void> =>
      ipcRenderer.invoke(IPC.recordAppendChunk, sessionId, sequence, bytes, mimeType),
    finalize: (meta: {
      width: number
      height: number
      mimeType: string
    }): Promise<RecoverableRecording> => ipcRenderer.invoke(IPC.recordFinalize, meta),
    preserveFailure: (message: string): Promise<RecoverableRecording | null> =>
      ipcRenderer.invoke(IPC.recordPreserveFailure, message),
    recoveries: (): Promise<RecoverableRecording[]> => ipcRenderer.invoke(IPC.recordRecoveries),
    recover: (id: string): Promise<RecoverableRecording> =>
      ipcRenderer.invoke(IPC.recordRecover, id),
    discardRecovery: (id: string): Promise<RecoverableRecording[]> =>
      ipcRenderer.invoke(IPC.recordDiscardRecovery, id),
    export: (
      opts: VideoExportOptions,
      meta: { width: number; height: number; durationMs: number; posterDataUrl?: string }
    ): Promise<LibraryItem | null> => ipcRenderer.invoke(IPC.recordExport, opts, meta),
    cancelExport: (): Promise<boolean> => ipcRenderer.invoke(IPC.recordCancelExport),
    onCommand: (handler: (payload: { command: string; options?: RecordingOptions }) => void) =>
      on(IPC.recordHudCommand, handler),
    /** Global cursor position stream while auto-zoom recording is live. */
    onCursor: (handler: (point: { x: number; y: number }) => void) => on(IPC.recordCursor, handler),
    onStatus: (handler: (status: RecordingStatus) => void) => on(IPC.recordStatus, handler),
    onProgress: (handler: (payload: { percent: number }) => void) => on(IPC.recordProgress, handler)
  },

  settings: {
    get: (): Promise<{
      settings: Settings
      hotkeyFailures: Array<{ action: string; accelerator: string }>
      platform: string
      version: string
    }> => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke(IPC.settingsSet, patch),
    reset: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsReset),
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.settingsPickDirectory),
    onChanged: (handler: (settings: Settings) => void) => on(IPC.settingsChanged, handler),
    onNavigate: (handler: (section: string) => void) => on(IPC.settingsNavigate, handler)
  },

  releaseNotes: {
    get: (): Promise<ReleaseNotesStatus> => ipcRenderer.invoke(IPC.releaseNotesGet),
    markSeen: (): Promise<ReleaseNotesStatus> => ipcRenderer.invoke(IPC.releaseNotesMarkSeen),
    onChanged: (handler: (status: ReleaseNotesStatus) => void) =>
      on(IPC.releaseNotesChanged, handler)
  },

  system: {
    permissions: (): Promise<{
      platform: string
      screen: string
      microphone: string
      camera: string
      screenVerified: boolean
    }> => ipcRenderer.invoke(IPC.permissionsCheck),
    requestPermission: (kind: 'microphone' | 'camera' | 'screen'): Promise<boolean> =>
      ipcRenderer.invoke(IPC.permissionsRequest, kind),
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC.openExternal, url),
    info: (): Promise<Record<string, string>> => ipcRenderer.invoke(IPC.appInfo),
    exportDiagnostics: (): Promise<SaveResult> => ipcRenderer.invoke(IPC.exportDiagnostics),
    checkForUpdate: (force = false): Promise<AppUpdateStatus> =>
      ipcRenderer.invoke(IPC.updateCheck, force),
    downloadUpdate: (): Promise<AppUpdateDownloadResult> => ipcRenderer.invoke(IPC.updateDownload),
    openManualUpdate: (): Promise<AppUpdateDownloadResult> =>
      ipcRenderer.invoke(IPC.updateManualDownload),
    installUpdate: (): Promise<AppUpdateInstallResult> => ipcRenderer.invoke(IPC.updateInstall),
    onUpdateStatus: (handler: (status: AppUpdateStatus) => void) => on(IPC.updateStatus, handler),
    window: (
      action:
        'minimize' | 'maximize' | 'close' | 'library' | 'settings' | 'settings-whats-new' | 'record'
    ) => ipcRenderer.send(IPC.windowControl, action),
    toast: (toast: Toast) => ipcRenderer.send(IPC.toast, toast),
    onToast: (handler: (toast: Toast) => void) => on(IPC.toast, handler),
    quit: (): Promise<void> => ipcRenderer.invoke(IPC.quit)
  },

  hud: {
    resize: (width: number, height: number) => ipcRenderer.send(IPC.hudResize, width, height),
    dock: (width: number, height: number) => ipcRenderer.send(IPC.hudDock, width, height),
    close: () => ipcRenderer.send(IPC.hudClose)
  },

  pin: {
    /** Pin an image as a floating always-on-top window. */
    create: (dataUrl: string, scaleFactor = 1): Promise<boolean> =>
      ipcRenderer.invoke(IPC.pinCreate, dataUrl, scaleFactor),
    onInit: (handler: (payload: { dataUrl: string; width: number; height: number }) => void) =>
      on(IPC.pinInit, handler)
  },

  quick: {
    onInit: (handler: (payload: unknown) => void) => on(IPC.quickInit, handler),
    action: (
      id: string,
      action: 'copy' | 'save' | 'pin' | 'edit' | 'reveal' | 'pipeline'
    ): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.quickAction, id, action),
    drag: (id: string): boolean => ipcRenderer.sendSync(IPC.quickDrag, id) as boolean
  },

  ocr: {
    onRequest: (handler: (payload: { id: string; dataUrl: string; rect?: unknown }) => void) =>
      on(IPC.ocrRequest, handler),
    respond: (id: string, result: OcrResult) => ipcRenderer.send(IPC.ocrResult, { id, result })
  }
}

export type ClipThatApi = typeof api

contextBridge.exposeInMainWorld('clipthat', api)
