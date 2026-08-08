import { app, BrowserWindow, clipboard, protocol } from 'electron'
import { promises as fs } from 'node:fs'
import { IPC } from '@shared/ipc'
import { installFileLogger, flushLog } from './log'
import { settings } from './store/settings'
import { libraryDir, recordingSessionsDir } from './store/paths'
import { registerIpcHandlers } from './ipc/handlers'
import { emitter, hotkeyFailures, registerHotkeys, unregisterHotkeys } from './hotkeys'
import { checkPermissions } from './permissions'
import { createTray, installAppMenu } from './tray'
import {
  broadcast,
  getSingleton,
  hasVisibleWindows,
  markEditorAppQuitRequested,
  showHudWindow,
  showLibraryWindow,
  showSettingsWindow
} from './windows/manager'
import { installOverlayPool, openOverlay, takeFrozenSnapshot } from './windows/overlay'
import { performCapture, routeResult } from './capture/service'
import { recording } from './recording/session'
import { indexBacklog, indexCapture, requestOcr } from './ocr'
import { library } from './store/library'
import { isRealPathInside } from './store/path-guard'
import { libraryFileResponse } from './protocol/library-file'
import { initializeAppUpdates } from './update/service'

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
  {
    scheme: 'clipthat',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: false
    }
  }
])

function registerLibraryProtocol(): void {
  protocol.handle('clipthat', async (request) => {
    try {
      const url = new URL(request.url)
      // clipthat://file/<absolute path, URI-encoded>
      const raw = decodeURIComponent(url.pathname.replace(/^\//, ''))
      // Resolve symlinks too: a path that only appears to live in an allowed root is not enough.
      const libraryFile = await isRealPathInside(libraryDir(), raw)
      const recoveryFile =
        recording.ownsRawPath(raw) && (await isRealPathInside(recordingSessionsDir(), raw))
      if (!libraryFile && !recoveryFile) {
        return new Response('forbidden', { status: 403 })
      }
      return libraryFileResponse(request, await fs.realpath(raw))
    } catch (error) {
      console.warn('[clipthat] library protocol failed', (error as Error).message)
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

  const snap = takeFrozenSnapshot(selection.displayId)
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

  await recording.initializeRecovery()
  await library.initialize()
  registerLibraryProtocol()
  registerIpcHandlers()
  initializeAppUpdates()
  recording.installDisplayMediaHandler()

  const s = settings.get()
  if (IS_MAC && !s.showInDock) app.dock?.hide()
  if (s.launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })
  }

  installAppMenu()
  createTray()
  registerHotkeys()
  // Pre-warm the capture overlays so the first hotkey press isn't the slow one.
  installOverlayPool()
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

  if (recording.recoveries().length > 0) showHudWindow('recovery')

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
  markEditorAppQuitRequested()
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
