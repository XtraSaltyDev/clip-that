import { app, BrowserWindow, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { SaveResult } from '@shared/types'
import { listDisplays } from '../capture/displays'
import { hotkeyFailures } from '../hotkeys'
import { library } from '../store/library'
import { checkPermissions } from '../permissions'
import { platformCapabilityMatrix } from '@shared/platform-capabilities'
import { bundledMediaCapabilities } from '../recording/ffmpeg'

function suggestedName(): string {
  return `ClipThat-diagnostics-${new Date().toISOString().slice(0, 10)}.json`
}

/** Create a local, user-initiated report. Nothing is uploaded by ClipThat. */
export async function exportDiagnostics(parent: BrowserWindow | null): Promise<SaveResult> {
  try {
    const [permissions, media] = await Promise.all([checkPermissions(), bundledMediaCapabilities()])
    const options: Electron.SaveDialogOptions = {
      title: 'Export ClipThat diagnostics',
      defaultPath: join(app.getPath('downloads'), suggestedName()),
      filters: [{ name: 'JSON report', extensions: ['json'] }]
    }
    const selection = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (selection.canceled || !selection.filePath) return { ok: false, canceled: true }

    const report = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      privacy: {
        uploaded: false,
        capturesIncluded: false,
        libraryIndexIncluded: false,
        settingsIncluded: false,
        logsIncluded: false,
        deviceNamesIncluded: false,
        windowTitlesIncluded: false,
        redaction:
          'No captures, library content, settings, logs, device names, or window titles are collected'
      },
      support: {
        supportedRelease: 'macOS Apple silicon',
        windows: 'unsigned experimental preview; real-hardware acceptance pending',
        linux: 'build configuration only; not runtime-accepted'
      },
      capabilities: platformCapabilityMatrix(process.platform),
      bundledMedia: media,
      app: {
        name: app.getName(),
        version: app.getVersion(),
        packaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
      },
      permissions,
      hotkeyFailures: hotkeyFailures().map(({ action }) => ({ action })),
      displays: listDisplays().map((display, index) => ({
        index: index + 1,
        bounds: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
        rotation: display.rotation,
        primary: display.primary,
        internal: display.internal
      })),
      libraryHealth: (() => {
        const { detail: _detail, ...health } = library.health()
        return health
      })()
    }
    await fs.writeFile(selection.filePath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    return { ok: true, filePath: selection.filePath }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
