import { app, BrowserWindow, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SaveResult } from '@shared/types'
import { listDisplays } from '../capture/displays'
import { hotkeyFailures } from '../hotkeys'
import { library } from '../store/library'
import { settings } from '../store/settings'
import { checkPermissions } from '../permissions'
import { logFilePath } from '../log'
import { redactDiagnosticsText } from './redact'

async function readLog(path: string): Promise<string> {
  return fs.readFile(path, 'utf8').catch(() => '')
}

function suggestedName(): string {
  return `ClipThat-diagnostics-${new Date().toISOString().slice(0, 10)}.json`
}

/** Create a local, user-initiated report. Nothing is uploaded by ClipThat. */
export async function exportDiagnostics(parent: BrowserWindow | null): Promise<SaveResult> {
  try {
    const logPath = logFilePath()
    const [permissions, currentLog, previousLog] = await Promise.all([
      checkPermissions(),
      readLog(logPath),
      readLog(`${logPath}.1`)
    ])
    const sensitivePaths = [
      app.getPath('home'),
      app.getPath('userData'),
      app.getPath('temp'),
      tmpdir(),
      settings.get().saveDirectory
    ]
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
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      privacy: {
        uploaded: false,
        capturesIncluded: false,
        libraryIndexIncluded: false,
        settingsIncluded: false,
        redaction: 'best-effort; review this file before sharing'
      },
      support: {
        supportedRelease: 'macOS Apple silicon',
        windows: 'experimental and not runtime-accepted',
        linux: 'build configuration only; not runtime-accepted'
      },
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
      hotkeyFailures: hotkeyFailures(),
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
        const health = library.health()
        return {
          ...health,
          detail: health.detail
            ? redactDiagnosticsText(health.detail, sensitivePaths)
            : undefined
        }
      })(),
      logs: redactDiagnosticsText(
        [
          previousLog ? '--- previous log ---\n' + previousLog : '',
          currentLog ? '--- current log ---\n' + currentLog : ''
        ]
          .filter(Boolean)
          .join('\n'),
        sensitivePaths
      )
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
