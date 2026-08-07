import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import { dialog } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  CaptureRequest,
  ClipDocument,
  LibraryItem,
  LibraryQuery,
  RecordingOptions,
  SaveImageRequest,
  Settings,
  VideoExportOptions
} from '@shared/types'
import { logFilePath } from '../log'
import { createPin } from '../windows/pins'
import { quickCache } from '../windows/quick'
import { openResultInEditor } from '../capture/service'
import { formatFilename } from '@shared/defaults'
import { settings } from '../store/settings'
import { library } from '../store/library'
import {
  cancelScrollCapture,
  appendScrollFrameBytes,
  documentFromCapture,
  finishScrollCapture,
  loadLibraryDocument,
  openInExistingEditor,
  openInEditor,
  performCapture,
  releasePendingDocument,
  routeResult,
  scrollCaptureActive,
  scrollCaptureConfig,
  startScrollFallback,
  switchEditorToLibraryItem,
  takePendingDocument
} from '../capture/service'
import { closeOverlay, setOverlayEditorsVisible, type OverlaySelection } from '../windows/overlay'
import { listWindows, windowPreview } from '../capture/backend'
import { listDisplays } from '../capture/displays'
import {
  broadcast,
  closeHudWindow,
  editorWindows,
  getSingleton,
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
import { ffmpegAvailable } from '../recording/ffmpeg'
import { checkPermissions, openScreenRecordingSettings, requestPermission } from '../permissions'
import { registerHotkeys, hotkeyFailures } from '../hotkeys'
import { refreshTray, syncTrayVisibility, installAppMenu } from '../tray'
import * as validate from './validation'
import {
  initialLibraryOpenAction,
  libraryOpenActionFromResponse,
  savedLibraryOpenBehavior
} from '../library/open-policy'

let cursorFeed: NodeJS.Timeout | null = null

/** Stream the global cursor position to the recorder at ~30Hz for the zoom camera. */
function startCursorFeed(): void {
  stopCursorFeed()
  cursorFeed = setInterval(() => {
    const hud = getSingleton('hud')
    if (!hud || hud.isDestroyed()) {
      stopCursorFeed()
      return
    }
    hud.webContents.send('record:cursor', screen.getCursorScreenPoint())
  }, 33)
}

function stopCursorFeed(): void {
  if (cursorFeed) clearInterval(cursorFeed)
  cursorFeed = null
}

export function registerIpcHandlers(): void {
  /* ---------------- capture ---------------- */

  ipcMain.handle(IPC.captureStart, async (_e, req: CaptureRequest) =>
    performCapture(validate.captureRequest(req))
  )

  ipcMain.handle(IPC.captureDisplays, () => listDisplays())
  ipcMain.handle(IPC.captureWindows, () => listWindows())
  ipcMain.handle(IPC.captureWindowPreview, (_e, windowId: string) =>
    windowPreview(validate.idValue(windowId, 'window id'))
  )

  // Overlay renderers report their result here.
  ipcMain.on(IPC.captureRegionResult, (_e, selection: OverlaySelection) => {
    closeOverlay(selection)
  })
  ipcMain.on(IPC.captureCancel, () => {
    closeOverlay(null)
    if (scrollCaptureActive()) cancelScrollCapture()
  })
  ipcMain.handle(IPC.captureEditorVisibility, (e, visible: unknown) => {
    if (typeof visible !== 'boolean') throw new Error('editor visibility must be a boolean')
    return setOverlayEditorsVisible(BrowserWindow.fromWebContents(e.sender), visible)
  })

  ipcMain.handle(IPC.captureClipboard, () => {
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

  ipcMain.handle(IPC.captureScrollConfig, (e) => {
    const hud = getSingleton('hud')
    if (!hud || hud.webContents.id !== e.sender.id) return null
    return scrollCaptureConfig()
  })
  ipcMain.on(IPC.captureScrollFrame, (e, bytes: Uint8Array) => {
    const hud = getSingleton('hud')
    if (!hud || hud.webContents.id !== e.sender.id) return
    appendScrollFrameBytes(bytes)
  })
  ipcMain.on(IPC.captureScrollFallback, (e, reason: string) => {
    const hud = getSingleton('hud')
    if (!hud || hud.webContents.id !== e.sender.id) return
    startScrollFallback(typeof reason === 'string' ? reason.slice(0, 240) : 'live stream unavailable')
  })

  ipcMain.handle(IPC.captureScrollStitch, async () => {
    const result = await finishScrollCapture()
    closeHudWindow()
    if (!result) return null
    await routeResult(result)
    return result
  })

  /* ---------------- editor ---------------- */

  ipcMain.handle(IPC.editorLoad, (e) => takePendingDocument(e.sender.id))
  ipcMain.on(IPC.editorClose, (e) => {
    releasePendingDocument(e.sender.id)
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
  ipcMain.handle(IPC.editorOpen, (_e, doc: ClipDocument) => {
    openInEditor(validate.clipDocument(doc))
    return true
  })
  ipcMain.handle(IPC.editorSwitchLibraryItem, (e, id: string) =>
    switchEditorToLibraryItem(e.sender.id, validate.idValue(id))
  )

  /* ---------------- export ---------------- */

  ipcMain.handle(IPC.saveImage, async (_e, req: SaveImageRequest) =>
    saveImage(validate.saveImageRequest(req))
  )
  ipcMain.handle(IPC.copyImage, (_e, dataUrl: string) =>
    copyImageToClipboard(validate.imageDataUrl(dataUrl))
  )
  ipcMain.handle(IPC.exportPdf, async (_e, dataUrl: string, name?: string) =>
    exportPdf(validate.imageDataUrl(dataUrl), name === undefined ? undefined : validate.idValue(name, 'PDF name'))
  )
  ipcMain.handle(IPC.saveProject, async (_e, doc: ClipDocument, saveAs = true) =>
    saveProject(validate.clipDocument(doc), Boolean(saveAs))
  )
  ipcMain.handle(IPC.openProject, async () => openProjectDialog())
  ipcMain.handle(IPC.startDrag, async (e, dataUrl: string, name: string) => {
    await startDrag(e, validate.imageDataUrl(dataUrl), validate.idValue(name, 'drag name'))
  })
  ipcMain.handle(IPC.revealFile, (_e, filePath: string) => {
    const path = validate.pathValue(filePath)
    if (!library.ownsPath(path)) throw new TypeError('file is not in the library')
    revealFile(path)
  })
  ipcMain.handle(IPC.openFile, async (_e, filePath: string) => {
    const path = validate.pathValue(filePath)
    if (!library.ownsPath(path)) throw new TypeError('file is not in the library')
    return openFile(path)
  })

  /* ---------------- library ---------------- */

  ipcMain.handle(IPC.libraryList, (_e, query: LibraryQuery) =>
    library.list(validate.libraryQuery(query))
  )
  ipcMain.handle(IPC.libraryTags, () => library.allTags())
  ipcMain.handle(
    IPC.libraryAdd,
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
  ipcMain.handle(IPC.libraryUpdate, (_e, id: string, patch: Partial<LibraryItem>) =>
    library.update(validate.idValue(id), validate.libraryPatch(patch))
  )
  ipcMain.handle(IPC.libraryDelete, async (_e, ids: string[]) => {
    await library.remove(validate.idList(ids))
    return true
  })
  ipcMain.handle(IPC.libraryLoadProject, async (_e, id: string) =>
    library.loadProject(validate.idValue(id))
  )
  ipcMain.handle(IPC.libraryOpen, async (e, id: string) => {
    const item = library.get(validate.idValue(id))
    if (!item) return false
    if (item.kind === 'video') {
      await shell.openPath(item.filePath)
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
        detail: 'An editor is already open. You can replace its current item or use another window.',
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

  /* ---------------- recording ---------------- */

  ipcMain.handle(IPC.recordSources, async () => {
    // The setup screen gives this lookup time to finish before Start is pressed, without
    // competing with unrelated screenshot work at application launch.
    await recording.prewarmDisplaySources()
    return {
      displays: listDisplays(),
      // Enumerating windows needs screen-recording permission on macOS. Failing here must not
      // take the whole picker down — screen recording still works from the display list.
      windows: await listWindows(false).catch(() => []),
      systemAudioSupported: recording.systemAudioSupported(),
      ffmpeg: await ffmpegAvailable()
    }
  })

  ipcMain.handle(IPC.recordConfigure, (_e, options: RecordingOptions) =>
    recording.configure(validate.recordingOptions(options))
  )

  ipcMain.handle(IPC.recordStart, (_e, options: RecordingOptions) => {
    const safeOptions = validate.recordingOptions(options)
    recording.beginCountdown(safeOptions)
    const hud = showHudWindow()
    hud.webContents.send(IPC.recordHudCommand, { command: 'start', options: safeOptions })
    return recording.status()
  })

  ipcMain.on('record:started', () => {
    recording.markStarted()
    if (recording.status().options?.autoZoom) startCursorFeed()
    refreshTray()
  })

  ipcMain.handle(IPC.recordPause, () => {
    recording.pause()
    getSingleton('hud')?.webContents.send(IPC.recordHudCommand, { command: 'pause' })
    return recording.status()
  })

  ipcMain.handle(IPC.recordResume, () => {
    recording.resume()
    getSingleton('hud')?.webContents.send(IPC.recordHudCommand, { command: 'resume' })
    return recording.status()
  })

  ipcMain.handle(IPC.recordStop, () => {
    stopCursorFeed()
    recording.markStopping()
    getSingleton('hud')?.webContents.send(IPC.recordHudCommand, { command: 'stop' })
    return recording.status()
  })

  ipcMain.handle(IPC.recordCancel, async () => {
    stopCursorFeed()
    getSingleton('hud')?.webContents.send(IPC.recordHudCommand, { command: 'cancel' })
    await recording.discard()
    closeHudWindow()
    refreshTray()
    return recording.status()
  })

  ipcMain.handle(IPC.recordSaveBlob, async (_e, bytes: Uint8Array) =>
    recording.saveRaw(validate.recordingBytes(bytes))
  )

  ipcMain.handle(
    IPC.recordExport,
    async (
      e,
      opts: VideoExportOptions,
      meta: { width: number; height: number; durationMs: number; posterDataUrl?: string }
    ) => {
      try {
        const item = await recording.export(
          validate.videoExportOptions(opts),
          validate.recordingMeta(meta),
          (percent) => {
          e.sender.send(IPC.recordProgress, { percent })
          broadcast(IPC.recordProgress, { percent })
          }
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
        await recording.discard()
        closeHudWindow()
        refreshTray()
        broadcast(IPC.toast, {
          kind: 'error',
          message: 'Could not encode the recording',
          detail: (err as Error).message
        })
        return null
      }
    }
  )

  ipcMain.handle(IPC.recordStatus, () => recording.status())

  /* ---------------- settings ---------------- */

  ipcMain.handle(IPC.settingsGet, () => ({
    settings: settings.get(),
    hotkeyFailures: hotkeyFailures(),
    platform: process.platform,
    version: app.getVersion()
  }))

  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<Settings>) => {
    const before = settings.get()
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

  ipcMain.handle(IPC.settingsReset, () => {
    const next = settings.reset()
    registerHotkeys()
    installAppMenu()
    refreshTray()
    broadcast(IPC.settingsChanged, next)
    return next
  })

  ipcMain.handle(IPC.settingsPickDirectory, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose where captures are saved',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settings.get().saveDirectory
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  /* ---------------- system ---------------- */

  ipcMain.handle(IPC.permissionsCheck, () => checkPermissions())
  ipcMain.handle(IPC.permissionsRequest, async (_e, kind: 'microphone' | 'camera' | 'screen') => {
    if (kind === 'screen') {
      await openScreenRecordingSettings()
      return false
    }
    return requestPermission(kind)
  })

  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
    log: logFilePath()
  }))

  ipcMain.on(
    IPC.windowControl,
    (e, action: 'minimize' | 'maximize' | 'close' | 'library' | 'settings' | 'record') => {
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
        case 'record':
          if (recording.status().state === 'idle') showHudWindow()
          break
      }
    }
  )

  ipcMain.on(IPC.toast, (_e, toast) => broadcast(IPC.toast, toast))

  /* ---------------- pins & quick access ---------------- */

  ipcMain.handle(IPC.pinCreate, (_e, dataUrl: string, scaleFactor = 1) =>
    Boolean(createPin(validate.imageDataUrl(dataUrl), { scaleFactor: validate.scaleFactorValue(scaleFactor) }))
  )

  ipcMain.handle(IPC.quickAction, async (_e, id: string, action: string) => {
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
      default:
        return { ok: false, error: `unknown action ${action}` }
    }
  })

  ipcMain.handle('quick:drag', async (e, id: string) => {
    const entry = quickCache().get(id)
    if (!entry) return
    const name = entry.result.title || formatFilename(settings.get().filenameTemplate)
    await startDrag(e, entry.result.dataUrl, name)
  })

  ipcMain.handle(IPC.quit, () => app.quit())

  library.on('changed', () => broadcast(IPC.libraryChanged))
  recording.on('status', (status) => broadcast(IPC.recordStatus, status))
}
