import { app, shell } from 'electron'
import { EventEmitter } from 'node:events'
import { get as httpsGet } from 'node:https'
import electronUpdater from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import type {
  AppUpdateDownloadResult,
  AppUpdateInstallResult,
  AppUpdateStatus
} from '@shared/types'
import {
  UPDATE_MANIFEST_URL,
  compareSemanticVersions,
  parseUpdateManifest,
  type ValidatedUpdateRelease
} from './contract'
import { InvalidUpdateMetadataError, validateMacUpdateMetadata } from './metadata'
import { UPDATE_CA_CERTIFICATE, installUpdateCertificateTrust } from './trust'

const MAX_MANIFEST_BYTES = 64 * 1024
const CHECK_TIMEOUT_MS = 5_000
const SUCCESS_CACHE_MS = 15 * 60 * 1_000
const FAILURE_CACHE_MS = 60 * 1_000

class InvalidUpdateResponse extends Error {}
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
  return app.getVersion()
}

function setStatus(next: AppUpdateStatus): AppUpdateStatus {
  status = next
  events.emit('status', next)
  return next
}

function unavailableReason(error: unknown): 'network' | 'trust' | 'invalid-response' {
  if (error instanceof InvalidUpdateResponse || error instanceof InvalidUpdateMetadataError) {
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
  installUpdateCertificateTrust(autoUpdater.netSession)
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
    return { ok: false, error: 'Internal updates support macOS on Apple silicon.' }
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
            ? 'The public update channel is unavailable. Connect to VPN and try again.'
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
    return { ok: false, error: 'Internal updates support macOS on Apple silicon.' }
  }
  if (status?.state !== 'ready') return { ok: false, error: 'No downloaded update is ready.' }
  console.log(`[updates] installing ClipThat ${status.latestVersion} on explicit user request`)
  autoUpdater.quitAndInstall(false, true)
  return { ok: true }
}

/* Legacy DMG fallback retained so 0.1.5 remains recoverable if managed updating fails. */
function fetchManifestBody(): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    let deadline: NodeJS.Timeout | null = null
    const finish = (error?: Error, body?: string): void => {
      if (settled) return
      settled = true
      if (deadline) clearTimeout(deadline)
      error ? reject(error) : resolve(body ?? '')
    }
    const request = httpsGet(
      UPDATE_MANIFEST_URL,
      {
        agent: false,
        ca: UPDATE_CA_CERTIFICATE,
        headers: { Accept: 'application/json' },
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
      },
      (response) => {
        response.on('error', (error) => finish(new UpdateNetworkError(error.message)))
        if (response.statusCode !== 200 || response.headers.location) {
          finish(new InvalidUpdateResponse('manifest response did not come from the expected URL'))
          response.destroy()
          request.destroy()
          return
        }
        const contentType = response.headers['content-type']?.toLowerCase() ?? ''
        if (!contentType.startsWith('application/json')) {
          finish(new InvalidUpdateResponse('manifest response is not JSON'))
          response.destroy()
          request.destroy()
          return
        }
        const chunks: Buffer[] = []
        let total = 0
        response.on('data', (chunk: Buffer) => {
          total += chunk.byteLength
          if (total > MAX_MANIFEST_BYTES) {
            finish(new InvalidUpdateResponse('manifest body is outside the supported size'))
            response.destroy()
            request.destroy()
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          if (!response.complete || total === 0) {
            finish(new UpdateNetworkError('manifest response ended early'))
            return
          }
          try {
            finish(undefined, new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
          } catch {
            finish(new InvalidUpdateResponse('manifest response is not valid UTF-8'))
          }
        })
      }
    )
    deadline = setTimeout(
      () => request.destroy(new UpdateNetworkError('manifest request timed out')),
      CHECK_TIMEOUT_MS
    )
    request.on('error', (error) =>
      finish(error instanceof UpdateNetworkError ? error : new UpdateNetworkError(error.message))
    )
  })
}

async function fetchLegacyRelease(): Promise<ValidatedUpdateRelease> {
  let value: unknown
  try {
    value = JSON.parse(await fetchManifestBody())
  } catch (error) {
    if (error instanceof InvalidUpdateResponse || error instanceof UpdateNetworkError) throw error
    throw new InvalidUpdateResponse('manifest response is not valid JSON')
  }
  try {
    return parseUpdateManifest(value)
  } catch (error) {
    throw new InvalidUpdateResponse((error as Error).message)
  }
}

export async function openManualAppUpdateDownload(): Promise<AppUpdateDownloadResult> {
  if (!supported()) {
    return { ok: false, error: 'Internal updates support macOS on Apple silicon.' }
  }
  try {
    const release = await fetchLegacyRelease()
    if (compareSemanticVersions(release.version, currentVersion()) <= 0) {
      return { ok: false, error: 'No newer ClipThat release is available.' }
    }
    await shell.openExternal(release.downloadUrl)
    return { ok: true, state: 'browser' }
  } catch (error) {
    return { ok: false, error: `The manual DMG could not be opened: ${(error as Error).message}` }
  }
}
