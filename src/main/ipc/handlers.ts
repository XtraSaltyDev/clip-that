import { app, BrowserWindow, ipcMain, shell } from 'electron'
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
import { settings } from '../store/settings'
import { library } from '../store/library'
import {
  cancelScrollCapture,
  documentFromCapture,
  finishScrollCapture,
  openInEditor,
  performCapture,
  releasePendingDocument,
  routeResult,
  scrollCaptureActive,
  takePendingDocument
} from '../capture/service'
import { closeOverlay, type OverlaySelection } from '../windows/overlay'
import { listWindows } from '../capture/backend'
import { listDisplays } from '../capture/displays'
import {
  broadcast,
  closeHudWindow,
  getSingleton,
  showHudWindow,
  showLibraryWindow,
  showSettingsWindow
} from '../windows/manager'
import {
  copyImageToClipboard,
  exportPdf,
  loadProjectFile,
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

export function registerIpcHandlers(): void {
  /* ---------------- capture ---------------- */

  ipcMain.handle(IPC.captureStart, async (_e, req: CaptureRequest) => performCapture(req))

  ipcMain.handle(IPC.captureDisplays, () => listDisplays())
  ipcMain.handle(IPC.captureWindows, () => listWindows())

  // Overlay renderers report their result here.
  ipcMain.on(IPC.captureRegionResult, (_e, selection: OverlaySelection) => {
    closeOverlay(selection)
  })
  ipcMain.on(IPC.captureCancel, () => {
    closeOverlay(null)
    if (scrollCaptureActive()) cancelScrollCapture()
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
    openInEditor(doc)
    return true
  })

  /* ---------------- export ---------------- */

  ipcMain.handle(IPC.saveImage, async (_e, req: SaveImageRequest) => saveImage(req))
  ipcMain.handle(IPC.copyImage, (_e, dataUrl: string) => copyImageToClipboard(dataUrl))
  ipcMain.handle(IPC.exportPdf, async (_e, dataUrl: string, name?: string) => exportPdf(dataUrl, name))
  ipcMain.handle(IPC.saveProject, async (_e, doc: ClipDocument, saveAs = true) =>
    saveProject(doc, saveAs)
  )
  ipcMain.handle(IPC.openProject, async () => openProjectDialog())
  ipcMain.handle(IPC.startDrag, async (e, dataUrl: string, name: string) => {
    await startDrag(e, dataUrl, name)
  })
  ipcMain.handle(IPC.revealFile, (_e, filePath: string) => {
    revealFile(filePath)
  })
  ipcMain.handle(IPC.openFile, async (_e, filePath: string) => openFile(filePath))

  /* ---------------- library ---------------- */

  ipcMain.handle(IPC.libraryList, (_e, query: LibraryQuery) => library.list(query))
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
      if (payload.replaceId) {
        const updated = await library.replaceImage(
          payload.replaceId,
          payload.dataUrl,
          payload.project,
          payload.ocrText
        )
        if (updated) return updated
      }
      return library.addImage(payload)
    }
  )
  ipcMain.handle(IPC.libraryUpdate, (_e, id: string, patch: Partial<LibraryItem>) =>
    library.update(id, patch)
  )
  ipcMain.handle(IPC.libraryDelete, async (_e, ids: string[]) => {
    await library.remove(ids)
    return true
  })
  ipcMain.handle(IPC.libraryLoadProject, async (_e, id: string) => library.loadProject(id))
  ipcMain.handle(IPC.libraryOpen, async (_e, id: string) => {
    const item = library.get(id)
    if (!item) return false
    if (item.kind === 'video') {
      await shell.openPath(item.filePath)
      return true
    }
    const doc = (await library.loadProject(id)) ?? (await loadProjectFile(item.filePath))
    if (!doc) return false
    doc.id = item.id
    openInEditor(doc)
    return true
  })

  /* ---------------- recording ---------------- */

  ipcMain.handle(IPC.recordSources, async () => ({
    displays: listDisplays(),
    // Enumerating windows needs screen-recording permission on macOS. Failing here must not
    // take the whole picker down — screen recording still works from the display list.
    windows: await listWindows(false).catch(() => []),
    systemAudioSupported: recording.systemAudioSupported(),
    ffmpeg: await ffmpegAvailable()
  }))

  ipcMain.handle(IPC.recordConfigure, (_e, options: RecordingOptions) =>
    recording.configure(options)
  )

  ipcMain.handle(IPC.recordStart, (_e, options: RecordingOptions) => {
    recording.beginCountdown(options)
    const hud = showHudWindow()
    hud.webContents.send(IPC.recordHudCommand, { command: 'start', options })
    return recording.status()
  })

  ipcMain.on('record:started', () => {
    recording.markStarted()
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
    recording.markStopping()
    getSingleton('hud')?.webContents.send(IPC.recordHudCommand, { command: 'stop' })
    return recording.status()
  })

  ipcMain.handle(IPC.recordCancel, async () => {
    getSingleton('hud')?.webContents.send(IPC.recordHudCommand, { command: 'cancel' })
    await recording.discard()
    closeHudWindow()
    refreshTray()
    return recording.status()
  })

  ipcMain.handle(IPC.recordSaveBlob, async (_e, bytes: Uint8Array) => recording.saveRaw(bytes))

  ipcMain.handle(
    IPC.recordExport,
    async (
      e,
      opts: VideoExportOptions,
      meta: { width: number; height: number; durationMs: number; posterDataUrl?: string }
    ) => {
      try {
        const item = await recording.export(opts, meta, (percent) => {
          e.sender.send(IPC.recordProgress, { percent })
          broadcast(IPC.recordProgress, { percent })
        })
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

  ipcMain.handle(IPC.quit, () => app.quit())

  library.on('changed', () => broadcast(IPC.libraryChanged))
  recording.on('status', (status) => broadcast(IPC.recordStatus, status))
}
