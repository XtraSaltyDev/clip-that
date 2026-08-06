import { app, BrowserWindow, clipboard, ipcMain, protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { normalize, sep } from 'node:path'
import { IPC } from '@shared/ipc'
import { installFileLogger, flushLog, logFilePath } from './log'
import { settings } from './store/settings'
import { libraryDir } from './store/paths'
import { registerIpcHandlers } from './ipc/handlers'
import { emitter, hotkeyFailures, registerHotkeys, unregisterHotkeys } from './hotkeys'
import { checkPermissions } from './permissions'
import { createTray, installAppMenu } from './tray'
import {
  broadcast,
  closeHudWindow,
  dockHud,
  getSingleton,
  hasVisibleWindows,
  resizeWindow,
  showHudWindow,
  showLibraryWindow,
  showSettingsWindow
} from './windows/manager'
import { openOverlay } from './windows/overlay'
import { captureDisplay } from './capture/backend'
import { performCapture, routeResult } from './capture/service'
import { recording } from './recording/session'
import { indexBacklog, indexCapture, requestOcr } from './ocr'
import { library } from './store/library'

const IS_MAC = process.platform === 'darwin'

/* A single instance owns the global hotkeys; a second launch just wakes the first. */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showLibraryWindow()
  })
}

// Serve library files (thumbnails, recordings) to renderers without exposing `file://`.
protocol.registerSchemesAsPrivileged([
  { scheme: 'clipthat', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } }
])

function registerLibraryProtocol(): void {
  protocol.handle('clipthat', (request) => {
    try {
      const url = new URL(request.url)
      // clipthat://file/<absolute path, URI-encoded>
      const raw = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const resolved = normalize(raw)
      const root = normalize(libraryDir())
      // Only ever hand back files that live inside our own library directory.
      if (!resolved.startsWith(root.endsWith(sep) ? root : root + sep)) {
        return new Response('forbidden', { status: 403 })
      }
      return net.fetch(pathToFileURL(resolved).toString())
    } catch {
      return new Response('bad request', { status: 400 })
    }
  })
}

/* ------------------------------------------------------------------ *
 * Flows driven from the tray / global hotkeys
 * ------------------------------------------------------------------ */

async function grabTextFlow(): Promise<void> {
  const selection = await openOverlay('region')
  if (!selection) return

  const snap = await captureDisplay(selection.displayId)
  if (!snap) return

  const text = await requestOcr(snap.dataUrl, selection.rect)

  if (text.trim()) {
    clipboard.writeText(text.trim())
    broadcast(IPC.toast, {
      kind: 'success',
      message: 'Text copied',
      detail: text.trim().slice(0, 140)
    })
  } else {
    broadcast(IPC.toast, { kind: 'info', message: 'No text found in that region' })
  }
}

function startRecordingFlow(): void {
  if (recording.status().state !== 'idle') return
  showHudWindow()
}

function stopRecordingFlow(): void {
  const state = recording.status().state
  if (state !== 'recording' && state !== 'paused') return
  recording.markStopping()
  getSingleton('hud')?.webContents.send(IPC.recordHudCommand, { command: 'stop' })
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

app.whenReady().then(async () => {
  app.setName('ClipThat')
  installFileLogger()
  if (process.platform === 'win32') app.setAppUserModelId('dev.clipthat.app')

  registerLibraryProtocol()
  registerIpcHandlers()
  recording.installDisplayMediaHandler()

  // Window-level extras the IPC module doesn't own.
  ipcMain.on('hud:resize', (e, width: number, height: number) => {
    resizeWindow(BrowserWindow.fromWebContents(e.sender), width, height)
  })
  ipcMain.on('hud:dock', (_e, width: number, height: number) => dockHud(width, height))
  ipcMain.on('hud:close', () => closeHudWindow())

  const s = settings.get()
  if (IS_MAC && !s.showInDock) app.dock?.hide()
  if (s.launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })
  }

  installAppMenu()
  createTray()
  registerHotkeys()

  // Screen permission and hotkey conflicts are the two things that make the app look
  // broken while behaving exactly as written, so both are reported at startup.
  void checkPermissions().then((report) => {
    console.log(
      `[clipthat] screen=${report.screen} verified=${report.screenVerified} ` +
        `mic=${report.microphone} camera=${report.camera}`
    )
  })
  const failed = hotkeyFailures()
  console.log(
    failed.length === 0
      ? '[clipthat] all global shortcuts registered'
      : `[clipthat] shortcuts already taken by another app: ${failed
          .map((f) => `${f.action} (${f.accelerator})`)
          .join(', ')}`
  )

  emitter.on('start-recording', startRecordingFlow)
  emitter.on('stop-recording', stopRecordingFlow)
  emitter.on('grab-text', () => void grabTextFlow())

  // Every capture gets read so the library is searchable by its contents.
  library.on('added', (item: { id: string }) => indexCapture(item.id))
  setTimeout(indexBacklog, 4000)

  // First launch lands on Settings so the macOS permission prompt is explained
  // before the user hits a capture that silently returns black pixels.
  if (!s.onboarded) {
    showSettingsWindow('welcome')
    settings.set({ onboarded: true })
  } else if (!s.showInTray) {
    showLibraryWindow()
  }

  const selfTest = process.env['CLIPTHAT_SELF_TEST']
  if (selfTest) {
    const { runSelfTest } = await import('./dev/self-test')
    setTimeout(() => void runSelfTest(selfTest), 2500)
  }

  if (process.env['CLIPTHAT_DIAG_DISPLAYS']) {
    const { probeDisplays } = await import('./dev/display-probe')
    void probeDisplays()
  }

  // Development-only visual regression pass; see src/main/dev/visual-check.ts.
  const visualCheckDir = process.env['CLIPTHAT_VISUAL_CHECK']
  if (visualCheckDir && !app.isPackaged) {
    const { runVisualCheck } = await import('./dev/visual-check')
    void runVisualCheck(visualCheckDir)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 || !hasVisibleWindows()) {
      showLibraryWindow()
    }
  })
})

/**
 * `window-all-closed` never fires while the hidden OCR worker exists, so the
 * quit decision is made explicitly whenever a window goes away.
 */
app.on('browser-window-created', (_e, win) => {
  win.on('closed', () => {
    // A tick of slack so a window that is being replaced doesn't look like the last one.
    setTimeout(() => {
      if (!settings.get().showInTray && !hasVisibleWindows()) app.quit()
    }, 150)
  })
})

app.on('window-all-closed', () => {
  // With a tray icon the app is meant to live in the background.
  if (!settings.get().showInTray) app.quit()
})

app.on('will-quit', () => {
  unregisterHotkeys()
  settings.flush()
  flushLog()
})

app.on('before-quit', () => {
  if (recording.status().state === 'recording') stopRecordingFlow()
})

process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection', reason instanceof Error ? reason : String(reason))
})

// Keep unhandled failures from silently killing a capture.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught', err)
  broadcast(IPC.toast, { kind: 'error', message: 'Something went wrong', detail: err.message })
})

export { performCapture, routeResult }
