import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  CaptureRequest,
  CaptureResult,
  ClipDocument,
  DisplayInfo,
  LibraryItem,
  LibraryQuery,
  RecordingOptions,
  RecordingStatus,
  SaveImageRequest,
  SaveResult,
  Settings,
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
    fromClipboard: (): Promise<CaptureResult | null> => ipcRenderer.invoke(IPC.captureClipboard),
    finishScrolling: (): Promise<CaptureResult | null> =>
      ipcRenderer.invoke(IPC.captureScrollStitch),
    /* overlay-only */
    submitSelection: (selection: unknown) => ipcRenderer.send(IPC.captureRegionResult, selection),
    cancel: () => ipcRenderer.send(IPC.captureCancel),
    onOverlayInit: (handler: (payload: unknown) => void) => on('overlay:init', handler),
    onScrollFrameCount: (handler: (count: number) => void) => on('scroll:frame-count', handler)
  },

  editor: {
    /** Pull the document this window was opened with. */
    load: (): Promise<ClipDocument | null> => ipcRenderer.invoke(IPC.editorLoad),
    onDocument: (handler: (doc: ClipDocument) => void) => on(IPC.editorDocument, handler),
    open: (doc: ClipDocument): Promise<boolean> => ipcRenderer.invoke(IPC.editorOpen, doc),
    close: () => ipcRenderer.send(IPC.editorClose)
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
    list: (query: LibraryQuery = {}): Promise<LibraryItem[]> =>
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
    update: (id: string, patch: Partial<LibraryItem>): Promise<LibraryItem | undefined> =>
      ipcRenderer.invoke(IPC.libraryUpdate, id, patch),
    remove: (ids: string[]): Promise<boolean> => ipcRenderer.invoke(IPC.libraryDelete, ids),
    open: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.libraryOpen, id),
    loadProject: (id: string): Promise<ClipDocument | null> =>
      ipcRenderer.invoke(IPC.libraryLoadProject, id),
    onChanged: (handler: () => void) => on(IPC.libraryChanged, handler),
    /** Turn an absolute library path into a URL the renderer may load. */
    fileUrl: (filePath: string) => `clipthat://file/${encodeURIComponent(filePath)}`
  },

  recording: {
    sources: (): Promise<{
      displays: DisplayInfo[]
      windows: WindowInfo[]
      systemAudioSupported: boolean
      ffmpeg: boolean
    }> => ipcRenderer.invoke(IPC.recordSources),
    configure: (options: RecordingOptions): Promise<RecordingOptions> =>
      ipcRenderer.invoke(IPC.recordConfigure, options),
    start: (options: RecordingOptions): Promise<RecordingStatus> =>
      ipcRenderer.invoke(IPC.recordStart, options),
    started: () => ipcRenderer.send('record:started'),
    pause: (): Promise<RecordingStatus> => ipcRenderer.invoke(IPC.recordPause),
    resume: (): Promise<RecordingStatus> => ipcRenderer.invoke(IPC.recordResume),
    stop: (): Promise<RecordingStatus> => ipcRenderer.invoke(IPC.recordStop),
    cancel: (): Promise<RecordingStatus> => ipcRenderer.invoke(IPC.recordCancel),
    status: (): Promise<RecordingStatus> => ipcRenderer.invoke(IPC.recordStatus),
    saveBlob: (bytes: Uint8Array): Promise<string> => ipcRenderer.invoke(IPC.recordSaveBlob, bytes),
    export: (
      opts: VideoExportOptions,
      meta: { width: number; height: number; durationMs: number; posterDataUrl?: string }
    ): Promise<LibraryItem | null> => ipcRenderer.invoke(IPC.recordExport, opts, meta),
    onCommand: (handler: (payload: { command: string; options?: RecordingOptions }) => void) =>
      on(IPC.recordHudCommand, handler),
    /** Global cursor position stream while auto-zoom recording is live. */
    onCursor: (handler: (point: { x: number; y: number }) => void) => on('record:cursor', handler),
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
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(IPC.settingsSet, patch),
    reset: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsReset),
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.settingsPickDirectory),
    onChanged: (handler: (settings: Settings) => void) => on(IPC.settingsChanged, handler),
    onNavigate: (handler: (section: string) => void) => on('settings:navigate', handler)
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
    window: (action: 'minimize' | 'maximize' | 'close' | 'library' | 'settings' | 'record') =>
      ipcRenderer.send(IPC.windowControl, action),
    toast: (toast: Toast) => ipcRenderer.send(IPC.toast, toast),
    onToast: (handler: (toast: Toast) => void) => on(IPC.toast, handler),
    quit: (): Promise<void> => ipcRenderer.invoke(IPC.quit)
  },

  hud: {
    resize: (width: number, height: number) => ipcRenderer.send('hud:resize', width, height),
    dock: (width: number, height: number) => ipcRenderer.send('hud:dock', width, height),
    close: () => ipcRenderer.send('hud:close')
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
      action: 'copy' | 'save' | 'pin' | 'edit'
    ): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.quickAction, id, action),
    drag: (id: string): Promise<void> => ipcRenderer.invoke('quick:drag', id)
  },

  ocr: {
    onRequest: (
      handler: (payload: { id: string; dataUrl: string; rect?: unknown }) => void
    ) => on('ocr:request', handler),
    respond: (id: string, text: string) => ipcRenderer.send('ocr:result', { id, text })
  }
}

export type ClipThatApi = typeof api

contextBridge.exposeInMainWorld('clipthat', api)
