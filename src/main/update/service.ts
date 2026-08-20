import { app, shell } from 'electron'
import { EventEmitter } from 'node:events'
import electronUpdater from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import type {
  AppUpdateDownloadResult,
  AppUpdateInstallResult,
  AppUpdateStatus
} from '@shared/types'
import { compareSemanticVersions } from './version'
import { InvalidUpdateMetadataError, validateMacUpdateMetadata } from './metadata'
import { PRODUCT_VERSION } from '../product-version'

const SUCCESS_CACHE_MS = 15 * 60 * 1_000
const FAILURE_CACHE_MS = 60 * 1_000
const RELEASES_URL = 'https://github.com/XtraSaltyDev/clip-that/releases/latest'

class UpdateNetworkError extends Error {}

const { autoUpdater } = electronUpdater
const events = new EventEmitter()

let initialized = false
let checkedAtMs = 0
let inFlight: Promise<AppUpdateStatus> | null = null
let downloadInFlight: Promise<AppUpdateDownloadResult> | null = null
let availableInfo: UpdateInfo | null = null
let status: AppUpdateStatus | null = null

function supported(): boolean {
  return app.isPackaged && process.platform === 'darwin' && process.arch === 'arm64'
}

function currentVersion(): string {
  return PRODUCT_VERSION
}

function setStatus(next: AppUpdateStatus): AppUpdateStatus {
  status = next
  events.emit('status', next)
  return next
}

function unavailableReason(error: unknown): 'network' | 'trust' | 'invalid-response' {
  if (error instanceof InvalidUpdateMetadataError) {
    return 'invalid-response'
  }
  const message = (error as Error).message ?? ''
  if (/cert|certificate|err_ssl|self.signed|unable to verify|expired/i.test(message)) return 'trust'
  if (/yaml|sha512|update metadata|latest-mac|zip file not provided|invalid/i.test(message)) {
    return 'invalid-response'
  }
  return 'network'
}

function unavailable(error: unknown): AppUpdateStatus {
  const reason = unavailableReason(error)
  console.warn(`[updates] check failed (${reason}):`, (error as Error).message)
  return setStatus({
    state: 'unavailable',
    currentVersion: currentVersion(),
    reason,
    checkedAt: new Date().toISOString()
  })
}

function statusForInfo(info: UpdateInfo, isAvailable: boolean): AppUpdateStatus {
  const checkedAt = new Date().toISOString()
  const validated = validateMacUpdateMetadata(info)
  return isAvailable
    ? {
        state: 'available',
        currentVersion: currentVersion(),
        latestVersion: validated.version,
        publishedAt: validated.publishedAt,
        size: validated.size,
        checkedAt
      }
    : {
        state: 'current',
        currentVersion: currentVersion(),
        latestVersion: validated.version,
        checkedAt
      }
}

export function initializeAppUpdates(): void {
  if (initialized || !supported()) return
  initialized = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = currentVersion().includes('-')
  autoUpdater.logger = {
    info: (message?: unknown) => console.log('[updates]', message),
    warn: (message?: unknown) => console.warn('[updates]', message),
    error: (message?: unknown) => console.error('[updates]', message)
  }

  autoUpdater.on('update-available', (info) => {
    try {
      availableInfo = info
      checkedAtMs = Date.now()
      setStatus(statusForInfo(info, true))
    } catch (error) {
      availableInfo = null
      unavailable(error)
    }
  })
  autoUpdater.on('update-not-available', (info) => {
    try {
      availableInfo = null
      checkedAtMs = Date.now()
      setStatus(statusForInfo(info, false))
    } catch (error) {
      unavailable(error)
    }
  })
  autoUpdater.on('download-progress', (progress) => {
    const latestVersion = availableInfo?.version
    if (!latestVersion) return
    setStatus({
      state: 'downloading',
      currentVersion: currentVersion(),
      latestVersion,
      percent: Math.max(0, Math.min(100, progress.percent)),
      transferred: Math.max(0, progress.transferred),
      total: Math.max(0, progress.total),
      bytesPerSecond: Math.max(0, progress.bytesPerSecond)
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setStatus({
      state: 'ready',
      currentVersion: currentVersion(),
      latestVersion: info.version,
      downloadedAt: new Date().toISOString()
    })
  })
  autoUpdater.on('error', (error) => {
    if (status?.state === 'ready') return
    unavailable(error)
  })
}

export function onAppUpdateStatus(listener: (next: AppUpdateStatus) => void): () => void {
  events.on('status', listener)
  return () => events.off('status', listener)
}

function cacheIsFresh(): boolean {
  if (!status || checkedAtMs === 0) return false
  const ttl = status.state === 'unavailable' ? FAILURE_CACHE_MS : SUCCESS_CACHE_MS
  return Date.now() - checkedAtMs < ttl
}

export async function checkForAppUpdate(force = false): Promise<AppUpdateStatus> {
  if (!supported()) return { state: 'unsupported', currentVersion: currentVersion() }
  initializeAppUpdates()
  if (status?.state === 'downloading' || status?.state === 'ready') return status
  if (!force && cacheIsFresh() && status) return status
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      if (!result) throw new UpdateNetworkError('the updater is inactive')
      const isAvailable = compareSemanticVersions(result.updateInfo.version, currentVersion()) > 0
      availableInfo = isAvailable ? result.updateInfo : null
      checkedAtMs = Date.now()
      return setStatus(statusForInfo(result.updateInfo, isAvailable))
    } catch (error) {
      availableInfo = null
      checkedAtMs = Date.now()
      return unavailable(error)
    }
  })()

  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

export async function downloadAppUpdate(): Promise<AppUpdateDownloadResult> {
  if (!supported()) {
    return { ok: false, error: 'Updates support macOS on Apple silicon.' }
  }
  initializeAppUpdates()
  if (status?.state === 'ready') return { ok: true, state: 'ready' }
  if (downloadInFlight) return downloadInFlight

  downloadInFlight = (async () => {
    const checked =
      status?.state === 'available' && cacheIsFresh() ? status : await checkForAppUpdate(true)
    if (checked.state !== 'available' || !availableInfo) {
      return {
        ok: false,
        error:
          checked.state === 'unavailable'
            ? 'The update service is unavailable. Check your connection and try again.'
            : 'No newer ClipThat release is available.'
      }
    }

    try {
      setStatus({
        state: 'downloading',
        currentVersion: currentVersion(),
        latestVersion: checked.latestVersion,
        percent: 0,
        transferred: 0,
        total: checked.size,
        bytesPerSecond: 0
      })
      await autoUpdater.downloadUpdate()
      return { ok: true, state: 'ready' }
    } catch (error) {
      unavailable(error)
      return { ok: false, error: `The update could not be downloaded: ${(error as Error).message}` }
    }
  })()

  try {
    return await downloadInFlight
  } finally {
    downloadInFlight = null
  }
}

export function installAppUpdate(): AppUpdateInstallResult {
  if (!supported()) {
    return { ok: false, error: 'Updates support macOS on Apple silicon.' }
  }
  if (status?.state !== 'ready') return { ok: false, error: 'No downloaded update is ready.' }
  console.log(`[updates] installing ClipThat ${status.latestVersion} on explicit user request`)
  autoUpdater.quitAndInstall(false, true)
  return { ok: true }
}

export async function openManualAppUpdateDownload(): Promise<AppUpdateDownloadResult> {
  if (!supported()) {
    return { ok: false, error: 'Updates support macOS on Apple silicon.' }
  }
  try {
    await shell.openExternal(RELEASES_URL)
    return { ok: true, state: 'browser' }
  } catch (error) {
    return { ok: false, error: `The release page could not be opened: ${(error as Error).message}` }
  }
}
