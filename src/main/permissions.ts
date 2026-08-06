import { systemPreferences, shell, desktopCapturer } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface PermissionReport {
  platform: NodeJS.Platform
  screen: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'
  microphone: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'
  camera: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'
  /** True when we could actually read pixels — the only proof that matters. */
  screenVerified: boolean
}

const IS_MAC = process.platform === 'darwin'

export async function checkPermissions(): Promise<PermissionReport> {
  const report: PermissionReport = {
    platform: process.platform,
    screen: 'unknown',
    microphone: 'unknown',
    camera: 'unknown',
    screenVerified: false
  }

  if (IS_MAC) {
    report.screen = systemPreferences.getMediaAccessStatus('screen')
    report.microphone = systemPreferences.getMediaAccessStatus('microphone')
    report.camera = systemPreferences.getMediaAccessStatus('camera')
  } else {
    report.screen = 'granted'
    report.microphone = 'granted'
    report.camera = 'granted'
  }

  // macOS reports 'granted' before the app has been restarted post-approval, so confirm
  // by actually reading pixels — through the same CLI path the capture engine uses.
  // (Verifying via desktopCapturer produced false negatives: that API flakes on this
  // machine while real capture works fine.)
  if (IS_MAC) {
    const file = join(tmpdir(), `clipthat-verify-${Date.now()}.png`)
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('screencapture', ['-x', '-t', 'png', '-R0,0,4,4', file], (err) =>
          err ? reject(err) : resolve()
        )
      })
      const stat = await fs.stat(file)
      report.screenVerified = stat.size > 0
    } catch {
      report.screenVerified = false
    } finally {
      await fs.rm(file, { force: true }).catch(() => {})
    }
  } else {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 8, height: 8 }
      })
      report.screenVerified = sources.length > 0 && !sources[0].thumbnail.isEmpty()
    } catch {
      report.screenVerified = false
    }
  }

  return report
}

export async function requestPermission(kind: 'microphone' | 'camera' | 'screen'): Promise<boolean> {
  if (!IS_MAC) return true
  if (kind === 'screen') {
    await openScreenRecordingSettings()
    return false
  }
  try {
    return await systemPreferences.askForMediaAccess(kind)
  } catch {
    return false
  }
}

export async function openScreenRecordingSettings(): Promise<void> {
  if (!IS_MAC) return
  await shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
  )
}
