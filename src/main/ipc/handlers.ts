import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import { dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { releaseNotesStatus } from '@shared/release-notes'
import { hasUsableRecordingExport } from '@shared/recording-exports'
import type {
  CaptureRequest,
  ClipDocument,
  EditorContextMenuAction,
  EditorContextMenuRequest,
  LibraryItem,
  LibraryQuery,
  GuideExportFormat,
  RecordingOptions,
  RecordingPreflight,
  SaveImageRequest,
  Settings,
  Shape,
  VideoExportOptions
} from '@shared/types'
import type { SnagitImportProgress } from '@shared/types'
import { createPin } from '../windows/pins'
import { quickCache } from '../windows/quick'
import { openResultInEditor } from '../capture/service'
import { formatFilename } from '@shared/defaults'
import { settings } from '../store/settings'
import { recordingsDir } from '../store/paths'
import { releaseNotesStore } from '../store/release-notes'
import { PRODUCT_VERSION } from '../product-version'
import { library } from '../store/library'
import {
  cancelScrollCapture,
  appendScrollFrameBytes,
  documentFromCapture,
  finishScrollCapture,
  loadLibraryDocument,
  openInExistingEditor,
  openInEditor,
  openVideoInEditor,
  performCapture,
  openGuideStepInEditor,
  guideStepContext,
  releasePendingDocument,
  routeResult,
  scrollCaptureActive,
  scrollCaptureConfig,
  startScrollFallback,
  switchEditorToLibraryItem,
  takePendingDocument,
  takePendingVideo
} from '../capture/service'
import { guides } from '../store/guides'
import { captureGuideSource, captureGuideStep, setActiveGuideSession } from '../guides/session'
import { exportGuide } from '../guides/export'
import {
  closeOverlay,
  isPendingOverlayWindow,
  openOverlay,
  setOverlayEditorsVisible
} from '../windows/overlay'
import { listWindows, windowInfo, windowPreview } from '../capture/backend'
import { listDisplays } from '../capture/displays'
import {
  broadcast,
  closeHudWindow,
  editorWindows,
  getSingleton,
  markEditorCloseReady,
  resolveEditorClose,
  resizeWindow,
  dockHud,
  showHudWindow,
  showLibraryWindow,
  showSettingsWindow
} from '../windows/manager'
import {
  copyImageToClipboard,
  exportPdf,
  openProjectDialog,
  openFile,
  readImageFromClipboard,
  revealFile,
  saveImage,
  saveProject,
  startDrag
} from '../export'
import { recording } from '../recording/session'
import { exportLibraryVideo } from '../recording/library-video'
import {
  cancelSnagitImport,
  clearSnagitPlan,
  importSnagitLibrary,
  scanSnagitLibrary
} from '../import/snagit'
import { bundledMediaCapabilities } from '../recording/ffmpeg'
import { platformCapabilityMatrix } from '@shared/platform-capabilities'
import { checkPermissions, openScreenRecordingSettings, requestPermission } from '../permissions'
import { registerHotkeys, hotkeyFailures } from '../hotkeys'
import { refreshTray, syncTrayVisibility, installAppMenu } from '../tray'
import { exportDiagnostics } from '../diagnostics/export'
import {
  checkForAppUpdate,
  downloadAppUpdate,
  installAppUpdate,
  onAppUpdateStatus,
  openManualAppUpdateDownload
} from '../update/service'
import * as validate from './validation'
import { rendererRole, secureHandle, secureOn } from './sender'
import {
  initialLibraryOpenAction,
  libraryOpenActionFromResponse,
  savedLibraryOpenBehavior
} from '../library/open-policy'

let cursorFeed: NodeJS.Timeout | null = null
const videoExportControllers = new Map<number, AbortController>()
const recordingExportControllers = new Map<number, AbortController>()
let annotationClipboard: Shape[] = []

function parseEditorContextMenuRequest(value: unknown): EditorContextMenuRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('editor context menu request must be an object')
  }
  const input = value as Record<string, unknown>
  if (input.kind !== 'canvas' && input.kind !== 'selection') {
    throw new TypeError('editor context menu kind is not supported')
  }
  return {
    kind: input.kind,
    selectionCount: validate.numberValue(input.selectionCount, 'selection count', 0, 20_000),
    annotationCount: validate.numberValue(input.annotationCount, 'annotation count', 0, 20_000)
  }
}

function showEditorContextMenu(
  win: BrowserWindow | null,
  request: EditorContextMenuRequest
): Promise<EditorContextMenuAction | null> {
  type ContextMenuItem = Electron.MenuItemConstructorOptions & {
    action?: EditorContextMenuAction
  }
  const count = request.selectionCount
  const selectionLabel = count === 1 ? 'Annotation' : `${count} Annotations`
  const selectionItems: ContextMenuItem[] =
    request.kind === 'selection'
      ? [
          { label: `Copy ${selectionLabel}`, action: 'copy-annotations' },
          { label: `Duplicate ${selectionLabel}`, action: 'duplicate-annotations' },
          { label: `Delete ${selectionLabel}`, action: 'delete-annotations' },
          { type: 'separator' }
        ]
      : []
  const template: ContextMenuItem[] = [
    ...selectionItems,
    {
      label: 'Paste Annotation(s)',
      action: 'paste-annotations',
      enabled: annotationClipboard.length > 0
    },
    {
      label: 'Select All Annotations',
      action: 'select-all-annotations',
      enabled: request.annotationCount > 0
    },
    { type: 'separator' },
    { label: 'Copy Clip to Clipboard', action: 'copy-image' }
  ]

  return new Promise((resolve) => {
    let settled = false
    const finish = (action: EditorContextMenuAction | null): void => {
      if (settled) return
      settled = true
      resolve(action)
    }
    const menu = Menu.buildFromTemplate(
      template.map(({ action, ...item }) => ({
        ...item,
        click: action ? () => finish(action) : item.click
      }))
    )
    menu.popup({ window: win ?? undefined, callback: () => finish(null) })
  })
}

/** Stream the global cursor position to the recorder at ~30Hz for the zoom camera. */
function startCursorFeed(): void {
  stopCursorFeed()
  cursorFeed = setInterval(() => {
    const hud = getSingleton('hud')
    if (!hud || hud.isDestroyed()) {
      stopCursorFeed()
      return
    }
    hud.webContents.send(IPC.recordCursor, screen.getCursorScreenPoint())
  }, 33)
}

function stopCursorFeed(): void {
  if (cursorFeed) clearInterval(cursorFeed)
  cursorFeed = null
}

export function registerIpcHandlers(): void {
  onAppUpdateStatus((status) => broadcast(IPC.updateStatus, status))
  /* ---------------- capture ---------------- */

  secureHandle(
    IPC.captureStart,
    ['editor', 'library', 'settings'],
    async (_e, req: CaptureRequest) => performCapture(validate.captureRequest(req))
  )

  secureHandle(IPC.captureDisplays, ['hud'], () => listDisplays())
  secureHandle(IPC.captureWindows, ['overlay'], () => listWindows())
  secureHandle(IPC.captureWindowPreview, ['overlay'], (_e, windowId: string) =>
    windowPreview(validate.idValue(windowId, 'window id'))
  )
  secureHandle(IPC.captureWindowInfo, ['hud'], (_e, windowId: string) =>
    windowInfo(validate.idValue(windowId, 'window id'))
  )

  // Overlay renderers report their result here.
  secureOn(IPC.captureRegionResult, ['overlay'], (e, selection: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!isPendingOverlayWindow(win)) throw new Error('overlay is not active')
    closeOverlay(validate.overlaySelection(selection))
  })
  secureOn(IPC.captureCancel, ['overlay', 'hud'], (e) => {
    const role = rendererRole(e)
    const roleWindow = BrowserWindow.fromWebContents(e.sender)
    if (role === 'overlay') {
      if (!isPendingOverlayWindow(roleWindow)) throw new Error('overlay is not active')
      closeOverlay(null)
      return
    }
    if (!scrollCaptureActive()) throw new Error('no scrolling capture is active')
    cancelScrollCapture()
  })
  secureHandle(IPC.captureEditorVisibility, ['overlay'], (e, visible: unknown) => {
    return setOverlayEditorsVisible(
      BrowserWindow.fromWebContents(e.sender),
      validate.booleanValue(visible, 'editor visibility')
    )
  })

  secureHandle(IPC.captureClipboard, ['editor'], () => {
    const image = readImageFromClipboard()
    if (!image) return null
    const result = {
      id: `clipboard-${Date.now()}`,
      dataUrl: image.dataUrl,
      width: image.width,
      height: image.height,
      scaleFactor: 1,
      source: 'region' as const,
      createdAt: Date.now(),
      title: 'Clipboard'
    }
    openInEditor(documentFromCapture(result))
    return result
  })

  secureHandle(IPC.captureScrollConfig, ['hud'], (e) => {
    const hud = getSingleton('hud')
    if (!hud || hud.webContents.id !== e.sender.id) return null
    return scrollCaptureConfig()
  })
  secureOn(IPC.captureScrollFrame, ['hud'], (e, bytes: unknown) => {
    const hud = getSingleton('hud')
    if (!hud || hud.webContents.id !== e.sender.id) return
    appendScrollFrameBytes(validate.byteArray(bytes, 'scroll frame', 64 * 1024 * 1024))
  })
  secureOn(IPC.captureScrollFallback, ['hud'], (e, reason: unknown) => {
    const hud = getSingleton('hud')
    if (!hud || hud.webContents.id !== e.sender.id) return
    startScrollFallback(validate.recordingFailure(reason).slice(0, 240))
  })

  secureHandle(IPC.captureScrollStitch, ['hud'], async () => {
    const result = await finishScrollCapture()
    closeHudWindow()
    if (!result) return null
    await routeResult(result)
    return result
  })

  /* ---------------- editor ---------------- */

  secureHandle(IPC.editorLoad, ['editor'], (e) => takePendingDocument(e.sender.id))
  secureHandle(IPC.editorLoadVideo, ['editor'], (e) => takePendingVideo(e.sender.id))
  secureOn(IPC.editorClose, ['editor'], (e) => {
    releasePendingDocument(e.sender.id)
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
  secureHandle(IPC.editorConfirmClose, ['editor'], (e, allow: unknown) =>
    resolveEditorClose(e.sender.id, validate.booleanValue(allow, 'allow editor close'))
  )
  secureHandle(IPC.editorCloseReady, ['editor'], (e) => markEditorCloseReady(e.sender.id))
  secureHandle(IPC.editorOpen, ['editor'], (_e, doc: ClipDocument) => {
    openInEditor(validate.clipDocument(doc))
    return true
  })
  secureHandle(IPC.editorSwitchLibraryItem, ['editor'], (e, id: string) =>
    switchEditorToLibraryItem(e.sender.id, validate.idValue(id))
  )
  secureHandle(IPC.editorContextMenu, ['editor'], (e, request: unknown) =>
    showEditorContextMenu(
      BrowserWindow.fromWebContents(e.sender),
      parseEditorContextMenuRequest(request)
    )
  )
  secureHandle(IPC.editorAnnotationClipboardWrite, ['editor'], (_e, shapes: unknown) => {
    annotationClipboard = validate.annotationShapes(shapes)
    return annotationClipboard.length
  })
  secureHandle(IPC.editorAnnotationClipboardRead, ['editor'], () =>
    validate.annotationShapes(annotationClipboard)
  )

  /* ---------------- export ---------------- */

  secureHandle(IPC.saveImage, ['editor'], async (_e, req: SaveImageRequest) =>
    saveImage(validate.saveImageRequest(req))
  )
  secureHandle(IPC.copyImage, ['editor', 'library'], (_e, dataUrl: string) =>
    copyImageToClipboard(validate.imageDataUrl(dataUrl))
  )
  secureHandle(IPC.exportPdf, ['editor'], async (_e, dataUrl: string, name?: string) =>
    exportPdf(
      validate.imageDataUrl(dataUrl),
      name === undefined ? undefined : validate.idValue(name, 'PDF name')
    )
  )
  secureHandle(IPC.saveProject, ['editor'], async (_e, doc: ClipDocument, saveAs: unknown = true) =>
    saveProject(validate.clipDocument(doc), validate.booleanValue(saveAs, 'save as'))
  )
  secureHandle(IPC.openProject, ['editor'], async () => openProjectDialog())
  secureHandle(IPC.startDrag, ['editor'], async (e, dataUrl: string, name: string) => {
    await startDrag(e, validate.imageDataUrl(dataUrl), validate.idValue(name, 'drag name'))
  })
  secureHandle(IPC.revealFile, ['library', 'editor'], (_e, filePath: string) => {
    const path = validate.pathValue(filePath)
    if (!library.ownsPath(path)) throw new TypeError('file is not in the library')
    revealFile(path)
  })
  secureHandle(IPC.openFile, ['library'], async (_e, filePath: string) => {
    const path = validate.pathValue(filePath)
    if (!library.ownsPath(path)) throw new TypeError('file is not in the library')
    return openFile(path)
  })

  /* ---------------- library ---------------- */

  secureHandle(IPC.libraryList, ['editor', 'library'], (_e, query: LibraryQuery) =>
    library.list(validate.libraryQuery(query))
  )
  secureHandle(IPC.libraryTags, ['library'], () => library.allTags())
  secureHandle(IPC.libraryHealth, ['editor', 'library'], () => library.health())
  secureHandle(
    IPC.libraryAdd,
    ['editor'],
    async (
      _e,
      payload: {
        dataUrl: string
        title: string
        width: number
        height: number
        project?: ClipDocument
        ocrText?: string
        replaceId?: string
      }
    ) => {
      const safePayload = validate.libraryAddPayload(payload)
      if (safePayload.replaceId) {
        const updated = await library.replaceImage(
          safePayload.replaceId,
          safePayload.dataUrl,
          safePayload.project,
          safePayload.ocrText
        )
        if (updated) return updated
      }
      return library.addImage(safePayload)
    }
  )
  secureHandle(
    IPC.libraryUpdate,
    ['library', 'editor'],
    (_e, id: string, patch: Partial<LibraryItem>) =>
      library.update(validate.idValue(id), validate.libraryPatch(patch))
  )
  secureHandle(IPC.libraryDelete, ['library'], async (_e, ids: string[]) => {
    await library.remove(validate.idList(ids))
    return true
  })
  secureHandle(IPC.libraryLoadProject, ['library'], async (_e, id: string) =>
    library.loadProject(validate.idValue(id))
  )
  secureHandle(IPC.librarySnagitScan, ['library'], async () => {
    const pictures = app.getPath('pictures')
    const likely = join(pictures, 'Snagit')
    const defaultPath = await fs
      .stat(likely)
      .then((stat) => (stat.isDirectory() ? likely : pictures))
      .catch(() => pictures)
    const res = await dialog.showOpenDialog({
      title: 'Import Snagit library',
      properties: ['openDirectory'],
      defaultPath
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return scanSnagitLibrary(res.filePaths[0])
  })
  secureHandle(IPC.librarySnagitImport, ['library'], async (_e, planId: string) =>
    importSnagitLibrary(validate.snagitPlanId(planId), (next: SnagitImportProgress) => {
      broadcast(IPC.librarySnagitProgress, next)
    })
  )
  secureHandle(IPC.librarySnagitCancel, ['library'], (_e, planId: string) => {
    const safePlanId = validate.snagitPlanId(planId)
    const cancelled = cancelSnagitImport(safePlanId)
    if (!cancelled) clearSnagitPlan(safePlanId)
    return cancelled
  })

  /* ---------------- guides ---------------- */

  secureHandle(IPC.guideList, ['library'], (_e, search: unknown = '') =>
    guides.list(validate.guideSearch(search))
  )
  secureHandle(IPC.guideCreate, ['library'], async (_e, title: unknown = 'Untitled guide') => {
    const guide = await guides.create(validate.guidePatch({ title }).title || 'Untitled guide')
    broadcast(IPC.guideChanged, { guideId: guide.id })
    return guide
  })
  secureHandle(
    IPC.guideGet,
    ['library'],
    (_e, id: unknown) => guides.get(validate.idValue(id, 'guide id')) ?? null
  )
  secureHandle(IPC.guideSave, ['library'], async (_e, value: unknown) => {
    const guide = await guides.save(validate.guideDocument(value))
    broadcast(IPC.guideChanged, { guideId: guide.id })
    return guide
  })
  secureHandle(IPC.guideDelete, ['library'], async (_e, id: unknown) => {
    const guideId = validate.idValue(id, 'guide id')
    const removed = await guides.remove(guideId)
    if (removed) broadcast(IPC.guideChanged, { guideId })
    return removed
  })
  secureHandle(IPC.guideCapture, ['library'], async (_e, id: unknown, mode: unknown = 'region') => {
    const request = validate.captureRequest({ mode })
    if (request.mode === 'scrolling')
      throw new TypeError('Scrolling capture is unavailable for guides')
    return captureGuideStep(
      validate.idValue(id, 'guide id'),
      request.mode as Exclude<CaptureRequest['mode'], 'scrolling'>
    )
  })
  secureHandle(
    IPC.guideRecapture,
    ['library'],
    async (_e, guideValue: unknown, stepValue: unknown, mode: unknown = 'region') => {
      const request = validate.captureRequest({ mode })
      if (request.mode === 'scrolling')
        throw new TypeError('Scrolling capture is unavailable for guides')
      const result = await captureGuideSource(
        request.mode as Exclude<CaptureRequest['mode'], 'scrolling'>
      )
      if (!result) return null
      const guide = await guides.replaceCapture(
        validate.idValue(guideValue, 'guide id'),
        validate.idValue(stepValue, 'guide step id'),
        result,
        documentFromCapture(result)
      )
      broadcast(IPC.guideChanged, { guideId: guide.id })
      return guide
    }
  )
  secureHandle(IPC.guideImportStep, ['library'], async (_e, id: unknown) => {
    const guideId = validate.idValue(id, 'guide id')
    const project = await openProjectDialog()
    if (!project) return null
    const result = {
      id: project.id,
      dataUrl: project.image,
      width: project.imageWidth,
      height: project.imageHeight,
      scaleFactor: project.scaleFactor,
      source: 'region' as const,
      createdAt: Date.now(),
      title: project.title
    }
    const guide = await guides.addCapture(guideId, result, project, { kind: 'import' })
    broadcast(IPC.guideChanged, { guideId })
    return guide
  })
  secureHandle(IPC.guideAddExisting, ['library'], async (_e, id: unknown, value: unknown) => {
    const guideId = validate.idValue(id, 'guide id')
    const project = validate.clipDocument(value)
    const result = {
      id: project.id,
      dataUrl: project.image,
      width: project.imageWidth,
      height: project.imageHeight,
      scaleFactor: project.scaleFactor,
      source: 'region' as const,
      createdAt: Date.now(),
      title: project.title
    }
    const guide = await guides.addCapture(guideId, result, project, { kind: 'import' })
    broadcast(IPC.guideChanged, { guideId })
    return guide
  })
  secureHandle(IPC.guideEditStep, ['library'], (_e, guideValue: unknown, stepValue: unknown) => {
    const guideId = validate.idValue(guideValue, 'guide id')
    const stepId = validate.idValue(stepValue, 'guide step id')
    const guide = guides.get(guideId)
    const step = guide?.steps.find((candidate) => candidate.id === stepId)
    if (!step) return false
    openGuideStepInEditor(guideId, stepId, step.project)
    return true
  })
  secureHandle(
    IPC.guideSaveEditedStep,
    ['editor'],
    async (e, projectValue: unknown, renderedValue: unknown) => {
      const context = guideStepContext(e.sender.id)
      if (!context) return false
      const guide = await guides.saveEditedStep(
        context.guideId,
        context.stepId,
        validate.clipDocument(projectValue),
        validate.imageDataUrl(renderedValue, 'rendered guide step')
      )
      broadcast(IPC.guideChanged, { guideId: guide.id })
      return true
    }
  )
  secureHandle(IPC.guideEditorContext, ['editor'], (e) => guideStepContext(e.sender.id))
  secureHandle(IPC.guideExport, ['library'], async (_e, id: unknown, format: unknown) => {
    const guide = guides.get(validate.idValue(id, 'guide id'))
    if (!guide) throw new Error('Guide no longer exists')
    if (format !== 'markdown' && format !== 'html' && format !== 'pdf') {
      throw new TypeError('Guide export format is unsupported')
    }
    return exportGuide(guide, format as GuideExportFormat)
  })
  secureHandle(IPC.guideSetActive, ['library'], (_e, id: unknown) => {
    if (id === null) {
      setActiveGuideSession(null)
      return true
    }
    const guideId = validate.idValue(id, 'guide id')
    if (!guides.get(guideId)) throw new Error('Guide no longer exists')
    setActiveGuideSession(guideId)
    return true
  })
  secureHandle(IPC.libraryOpen, ['editor', 'library'], async (e, id: string) => {
    const item = library.get(validate.idValue(id))
    if (!item) return false
    if (item.kind === 'video') {
      openVideoInEditor(item)
      return true
    }
    const doc = await loadLibraryDocument(item.id)
    if (!doc) return false

    let action = initialLibraryOpenAction(
      settings.get().libraryOpenBehavior,
      editorWindows().length > 0
    )

    if (action === 'ask') {
      const parent = BrowserWindow.fromWebContents(e.sender)
      const options: Electron.MessageBoxOptions = {
        type: 'question',
        title: 'Open from Library',
        message: `Open “${item.title}” where?`,
        detail:
          'An editor is already open. You can replace its current item or use another window.',
        buttons: ['Existing Window', 'New Window', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        checkboxLabel: 'Do not ask again',
        checkboxChecked: false,
        noLink: true
      }
      const answer = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options)
      action = libraryOpenActionFromResponse(answer.response)
      const remembered = savedLibraryOpenBehavior(action, answer.checkboxChecked)
      if (remembered) {
        const next = settings.set({ libraryOpenBehavior: remembered })
        broadcast(IPC.settingsChanged, next)
      }
    }

    if (action === 'cancel') return false
    if (action === 'existing' && openInExistingEditor(doc)) return true
    openInEditor(doc)
    return true
  })
  secureHandle(
    IPC.libraryExportVideo,
    ['editor'],
    async (e, id: unknown, opts: unknown, posterDataUrl?: unknown) => {
      const poster =
        posterDataUrl === undefined
          ? undefined
          : validate.imageDataUrl(posterDataUrl, 'video poster')
      if (videoExportControllers.has(e.sender.id))
        throw new Error('A video export is already running')
      const controller = new AbortController()
      videoExportControllers.set(e.sender.id, controller)
      try {
        const item = await exportLibraryVideo(
          validate.idValue(id, 'recording id'),
          validate.videoExportOptions(opts),
          poster,
          ({ percent }) => e.sender.send(IPC.recordProgress, { percent }),
          controller.signal
        )
        broadcast(IPC.libraryChanged)
        refreshTray()
        return item
      } finally {
        videoExportControllers.delete(e.sender.id)
      }
    }
  )
  secureHandle(IPC.libraryCancelVideoExport, ['editor'], (e) => {
    const controller = videoExportControllers.get(e.sender.id)
    if (!controller) return false
    controller.abort()
    return true
  })

  /* ---------------- recording ---------------- */

  secureHandle(IPC.recordSources, ['hud'], async () => {
    // The setup screen gives this lookup time to finish before Start is pressed, without
    // competing with unrelated screenshot work at application launch.
    await recording.prewarmDisplaySources()
    const media = await bundledMediaCapabilities()
    return {
      displays: listDisplays(),
      // Enumerating windows needs screen-recording permission on macOS. Failing here must not
      // take the whole picker down — screen recording still works from the display list.
      windows: await listWindows(false).catch(() => []),
      systemAudioSupported: recording.systemAudioSupported(),
      media,
      capabilities: platformCapabilityMatrix(process.platform)
    }
  })

  secureHandle(IPC.recordSelectRegion, ['hud'], async () => {
    const selection = await openOverlay('region')
    if (!selection) return null
    return {
      displayId: selection.displayId,
      region: selection.rect,
      screenRect: selection.screenRect
    }
  })

  secureHandle(
    IPC.recordPreflight,
    ['hud'],
    async (_e, unsafeOptions: unknown): Promise<RecordingPreflight> => {
      const options = validate.recordingOptions(unsafeOptions)
      const [displays, windows, media] = await Promise.all([
        Promise.resolve(listDisplays()),
        listWindows(false).catch(() => []),
        bundledMediaCapabilities()
      ])
      const selectedSource =
        options.target === 'window'
          ? windows.find((item) => item.id === options.windowId)
          : displays.find((item) => item.id === options.displayId)
      const geometryReady =
        options.target !== 'window' ||
        !options.autoZoom ||
        Boolean(selectedSource && 'bounds' in selectedSource && selectedSource.bounds)
      const sourceReady =
        Boolean(selectedSource) &&
        (options.target !== 'region' || Boolean(options.region)) &&
        geometryReady
      const systemAudio = recording.systemAudioSupported()
      const destination = recordingsDir()
      let availableBytes: number | null = null
      try {
        const stats = await fs.statfs(destination)
        availableBytes = Number(stats.bavail * stats.bsize)
      } catch {
        availableBytes = null
      }
      const items: RecordingPreflight['items'] = [
        {
          id: 'source',
          label: 'Capture source',
          state: sourceReady ? 'supported' : 'unavailable',
          detail: sourceReady
            ? 'Selected source is available now'
            : geometryReady
              ? 'Choose an available source again'
              : 'Window geometry is unavailable; choose Screen or turn Auto-zoom off'
        },
        {
          id: 'system-audio',
          label: 'System audio',
          state: options.systemAudio ? (systemAudio ? 'unverified' : 'unavailable') : 'supported',
          detail: options.systemAudio
            ? systemAudio
              ? 'Platform API is available; verified when recording starts'
              : 'System audio capture is unavailable on this platform'
            : 'Not requested'
        },
        {
          id: 'ffmpeg',
          label: 'Bundled FFmpeg',
          state: media.ffmpeg ? 'supported' : 'unavailable',
          detail: media.ffmpeg
            ? 'Audited executable responded'
            : 'Bundled executable is missing or cannot run'
        },
        {
          id: 'ffprobe',
          label: 'Bundled ffprobe',
          state: media.ffprobe ? 'supported' : 'unavailable',
          detail: media.ffprobe
            ? 'Audited executable responded'
            : 'Bundled executable is missing or cannot run'
        },
        {
          id: 'encoder.mp4',
          label: 'MP4 encoder',
          state: media.mp4 ? 'supported' : 'unavailable',
          detail: media.mp4
            ? 'Compatible H.264 encoder is present'
            : 'No compatible H.264 encoder was found'
        },
        {
          id: 'encoder.webm',
          label: 'WebM encoders',
          state: media.webm ? 'supported' : 'unavailable',
          detail: media.webm
            ? 'VP9 and Opus encoders are present'
            : 'VP9 or Opus encoder is missing'
        },
        {
          id: 'encoder.gif',
          label: 'GIF encoder',
          state: media.gif ? 'supported' : 'unavailable',
          detail: media.gif ? 'GIF encoder is present' : 'GIF encoder is missing'
        },
        {
          id: 'destination',
          label: 'Destination',
          state:
            availableBytes === null
              ? 'unverified'
              : availableBytes >= 1024 * 1024 * 1024
                ? 'supported'
                : 'unavailable',
          detail:
            availableBytes === null
              ? 'Free space could not be verified'
              : `${(availableBytes / 1024 / 1024 / 1024).toFixed(1)} GB free`
        }
      ]
      return {
        checkedAt: Date.now(),
        items,
        canStart:
          sourceReady &&
          (!options.systemAudio || systemAudio) &&
          media.ffmpeg &&
          media.ffprobe &&
          hasUsableRecordingExport(media) &&
          (availableBytes === null || availableBytes >= 1024 * 1024 * 1024)
      }
    }
  )

  secureHandle(IPC.recordConfigure, ['hud'], (_e, options: RecordingOptions) =>
    recording.configure(validate.recordingOptions(options))
  )
  secureHandle(IPC.recordCaptureSource, ['hud'], () => recording.captureSourceId())

  secureHandle(IPC.recordStart, ['hud'], async (_e, options: RecordingOptions) => {
    const safeOptions = validate.recordingOptions(options)
    await recording.beginCountdown(safeOptions)
    showHudWindow()
    return recording.status()
  })

  secureHandle(IPC.recordStarted, ['hud'], async () => {
    await recording.markStarted()
    const options = recording.status().options
    if (options?.autoZoom && options.target !== 'region') startCursorFeed()
    refreshTray()
    return recording.status()
  })

  secureHandle(IPC.recordPause, ['hud'], async () => {
    await recording.pause()
    return recording.status()
  })

  secureHandle(IPC.recordResume, ['hud'], async () => {
    await recording.resume()
    return recording.status()
  })

  secureHandle(IPC.recordStop, ['hud'], () => {
    stopCursorFeed()
    recording.markStopping()
    return recording.status()
  })

  secureHandle(IPC.recordCancel, ['hud'], async () => {
    stopCursorFeed()
    await recording.discard()
    refreshTray()
    return recording.status()
  })

  secureHandle(
    IPC.recordAppendChunk,
    ['hud'],
    async (_e, sessionId: string, sequence: number, bytes: Uint8Array, mimeType: string) => {
      await recording.appendChunk(
        validate.idValue(sessionId, 'recording session id'),
        validate.recordingSequence(sequence),
        validate.recordingChunkBytes(bytes),
        validate.recordingMimeType(mimeType)
      )
    }
  )

  secureHandle(IPC.recordFinalize, ['hud'], async (_e, meta: unknown) =>
    recording.finalize(validate.recordingFinalizeMeta(meta))
  )

  secureHandle(IPC.recordPreserveFailure, ['hud'], async (_e, message: unknown) =>
    recording.preserveFailure(validate.recordingFailure(message))
  )

  secureHandle(IPC.recordRecoveries, ['hud'], () => recording.recoveries())

  secureHandle(IPC.recordRecover, ['hud'], async (_e, id: unknown) =>
    recording.recover(validate.idValue(id, 'recording recovery id'))
  )

  secureHandle(IPC.recordDiscardRecovery, ['hud'], async (_e, id: unknown) => {
    await recording.discardRecovery(validate.idValue(id, 'recording recovery id'))
    return recording.recoveries()
  })

  secureHandle(
    IPC.recordExport,
    ['hud'],
    async (
      e,
      opts: VideoExportOptions,
      meta: { width: number; height: number; durationMs: number; posterDataUrl?: string }
    ) => {
      if (recordingExportControllers.has(e.sender.id)) {
        throw new Error('A recording export is already running')
      }
      const controller = new AbortController()
      recordingExportControllers.set(e.sender.id, controller)
      try {
        const item = await recording.export(
          validate.videoExportOptions(opts),
          validate.recordingMeta(meta),
          (percent) => {
            e.sender.send(IPC.recordProgress, { percent })
            broadcast(IPC.recordProgress, { percent })
          },
          controller.signal
        )
        closeHudWindow()
        refreshTray()
        if (item) {
          broadcast(IPC.libraryChanged)
          broadcast(IPC.toast, {
            kind: 'success',
            message: 'Recording saved',
            detail: item.filePath
          })
        }
        return item
      } catch (err) {
        await recording.preserveFailure((err as Error).message)
        refreshTray()
        broadcast(IPC.toast, {
          kind: 'error',
          message: 'Could not encode the recording — the raw video was preserved',
          detail: (err as Error).message
        })
        return null
      } finally {
        recordingExportControllers.delete(e.sender.id)
      }
    }
  )

  secureHandle(IPC.recordCancelExport, ['hud'], (e) => {
    const controller = recordingExportControllers.get(e.sender.id)
    if (!controller) return false
    controller.abort()
    return true
  })

  secureHandle(IPC.recordStatus, ['hud'], () => recording.status())

  /* ---------------- settings ---------------- */

  secureHandle(IPC.settingsGet, ['editor', 'library', 'settings', 'hud'], () => ({
    settings: settings.get(),
    hotkeyFailures: hotkeyFailures(),
    platform: process.platform,
    version: PRODUCT_VERSION
  }))

  secureHandle(IPC.settingsSet, ['settings'], (_e, unsafePatch: Partial<Settings>) => {
    const before = settings.get()
    const patch = validate.settingsPatch(unsafePatch, before)
    const next = settings.set(patch)
    if (patch.hotkeys) {
      registerHotkeys()
      installAppMenu()
      refreshTray()
    }
    if (patch.showInTray !== undefined && patch.showInTray !== before.showInTray) {
      syncTrayVisibility()
    }
    if (patch.launchAtLogin !== undefined && patch.launchAtLogin !== before.launchAtLogin) {
      app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin, openAsHidden: true })
    }
    if (patch.showInDock !== undefined && process.platform === 'darwin') {
      if (patch.showInDock) void app.dock?.show()
      else app.dock?.hide()
    }
    broadcast(IPC.settingsChanged, next)
    return next
  })

  secureHandle(IPC.settingsReset, ['settings'], () => {
    const next = settings.reset()
    registerHotkeys()
    installAppMenu()
    refreshTray()
    broadcast(IPC.settingsChanged, next)
    return next
  })

  secureHandle(IPC.settingsPickDirectory, ['settings'], async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose where captures are saved',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settings.get().saveDirectory
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  /* ---------------- bundled release notes ---------------- */

  const currentReleaseNotes = () =>
    releaseNotesStatus(PRODUCT_VERSION, releaseNotesStore.lastSeenVersion())

  secureHandle(IPC.releaseNotesGet, ['library', 'settings'], () => currentReleaseNotes())
  secureHandle(IPC.releaseNotesMarkSeen, ['library', 'settings'], () => {
    releaseNotesStore.markSeen(PRODUCT_VERSION)
    const next = currentReleaseNotes()
    broadcast(IPC.releaseNotesChanged, next)
    return next
  })

  /* ---------------- system ---------------- */

  secureHandle(IPC.permissionsCheck, ['settings'], () => checkPermissions())
  secureHandle(IPC.permissionsRequest, ['settings'], async (_e, unsafeKind: unknown) => {
    const kind = validate.permissionKind(unsafeKind)
    if (kind === 'screen') {
      await openScreenRecordingSettings()
      return false
    }
    return requestPermission(kind)
  })

  secureHandle(IPC.openExternal, ['editor'], async (_e, unsafeUrl: unknown) => {
    const url = validate.externalUrl(unsafeUrl)
    await shell.openExternal(url)
    return true
  })

  secureHandle(IPC.appInfo, ['settings'], () => ({
    version: PRODUCT_VERSION,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: String(app.isPackaged)
  }))
  secureHandle(IPC.exportDiagnostics, ['settings'], (e) =>
    exportDiagnostics(BrowserWindow.fromWebContents(e.sender))
  )
  secureHandle(IPC.updateCheck, ['library', 'settings'], (_e, unsafeForce: unknown = false) =>
    checkForAppUpdate(validate.booleanValue(unsafeForce, 'force update check'))
  )
  secureHandle(IPC.updateDownload, ['library', 'settings'], () => downloadAppUpdate())
  secureHandle(IPC.updateManualDownload, ['library', 'settings'], () =>
    openManualAppUpdateDownload()
  )
  secureHandle(IPC.updateInstall, ['library', 'settings'], () => {
    if (recording.status().state !== 'idle') {
      return { ok: false, error: 'Finish the active recording or export before restarting.' }
    }
    if (editorWindows().length > 0) {
      return { ok: false, error: 'Close ClipThat editor windows before restarting to update.' }
    }
    return installAppUpdate()
  })

  secureOn(
    IPC.windowControl,
    ['editor', 'library', 'settings', 'quick', 'pin'],
    (e, unsafeAction: unknown) => {
      const action = validate.windowAction(unsafeAction)
      const role = rendererRole(e)
      const allowedActions = {
        editor: ['minimize', 'maximize', 'close', 'library', 'settings', 'record'],
        library: ['minimize', 'maximize', 'close', 'settings', 'settings-whats-new', 'record'],
        settings: ['minimize', 'maximize', 'close', 'settings-whats-new', 'record'],
        quick: ['close'],
        pin: ['close']
      } as const
      if (
        !role ||
        !(
          allowedActions[role as keyof typeof allowedActions] as readonly string[] | undefined
        )?.includes(action)
      ) {
        throw new Error(`window action ${action} is not allowed for ${role ?? 'unknown'} renderer`)
      }
      const win = BrowserWindow.fromWebContents(e.sender)
      switch (action) {
        case 'minimize':
          win?.minimize()
          break
        case 'maximize':
          if (win?.isMaximized()) win.unmaximize()
          else win?.maximize()
          break
        case 'close':
          win?.close()
          break
        case 'library':
          showLibraryWindow()
          break
        case 'settings':
          showSettingsWindow()
          break
        case 'settings-whats-new':
          showSettingsWindow('whats-new')
          break
        case 'record':
          if (recording.status().state === 'idle') showHudWindow()
          break
      }
    }
  )

  secureOn(IPC.toast, ['editor', 'library', 'settings', 'hud'], (_e, toast) =>
    broadcast(IPC.toast, validate.toastValue(toast))
  )

  /* ---------------- pins & quick access ---------------- */

  secureHandle(IPC.pinCreate, ['editor'], (_e, dataUrl: string, scaleFactor = 1) =>
    Boolean(
      createPin(validate.imageDataUrl(dataUrl), {
        scaleFactor: validate.scaleFactorValue(scaleFactor)
      })
    )
  )

  secureHandle(IPC.quickAction, ['quick'], async (_e, unsafeId: unknown, unsafeAction: unknown) => {
    const id = validate.idValue(unsafeId, 'quick capture id')
    const action = validate.quickAction(unsafeAction)
    const entry = quickCache().get(id)
    if (!entry) return { ok: false, error: 'capture expired' }
    const { result, libraryId } = entry
    const s = settings.get()

    switch (action) {
      case 'copy':
        return { ok: copyImageToClipboard(result.dataUrl) }
      case 'save': {
        const saved = await saveImage({
          dataUrl: result.dataUrl,
          format: s.imageFormat,
          suggestedName: result.title || formatFilename(s.filenameTemplate)
        })
        return saved.ok ? { ok: true } : { ok: false, error: saved.error }
      }
      case 'pin':
        return { ok: Boolean(createPin(result.dataUrl, { scaleFactor: result.scaleFactor })) }
      case 'edit':
        openResultInEditor(result, libraryId)
        return { ok: true }
    }
  })

  secureHandle(IPC.quickDrag, ['quick'], async (e, unsafeId: unknown) => {
    const id = validate.idValue(unsafeId, 'quick capture id')
    const entry = quickCache().get(id)
    if (!entry) return
    const name = entry.result.title || formatFilename(settings.get().filenameTemplate)
    await startDrag(e, entry.result.dataUrl, name)
  })

  secureHandle(IPC.quit, ['settings'], () => app.quit())

  secureOn(IPC.hudResize, ['hud'], (e, width: unknown, height: unknown) => {
    resizeWindow(
      BrowserWindow.fromWebContents(e.sender),
      validate.numberValue(width, 'HUD width', 240, 2_000),
      validate.numberValue(height, 'HUD height', 60, 2_000)
    )
  })
  secureOn(IPC.hudDock, ['hud'], (_e, width: unknown, height: unknown) => {
    dockHud(
      validate.numberValue(width, 'HUD width', 240, 2_000),
      validate.numberValue(height, 'HUD height', 60, 2_000)
    )
  })
  secureOn(IPC.hudClose, ['hud'], () => {
    if (recording.status().state === 'idle') {
      closeHudWindow()
      return
    }
    void recording.discard().finally(closeHudWindow)
  })

  library.on('changed', () => broadcast(IPC.libraryChanged))
  library.on('issue', (health) => broadcast(IPC.libraryIssue, health))
  recording.on('status', (status) => broadcast(IPC.recordStatus, status))
}
