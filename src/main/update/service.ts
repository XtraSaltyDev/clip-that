import { app, shell } from 'electron'
import { get as httpsGet } from 'node:https'
import type { AppUpdateDownloadResult, AppUpdateStatus } from '@shared/types'
import {
  UPDATE_MANIFEST_URL,
  parseUpdateManifest,
  statusForUpdateRelease,
  type ValidatedUpdateRelease
} from './contract'
import { UPDATE_CA_CERTIFICATE } from './trust'

const MAX_MANIFEST_BYTES = 64 * 1024
const CHECK_TIMEOUT_MS = 5_000
const SUCCESS_CACHE_MS = 15 * 60 * 1_000
const FAILURE_CACHE_MS = 60 * 1_000

class InvalidUpdateResponse extends Error {}
class UpdateNetworkError extends Error {}

interface CheckResult {
  status: AppUpdateStatus
  release?: ValidatedUpdateRelease
}

let cached: { checkedAt: number; result: CheckResult } | null = null
let inFlight: Promise<CheckResult> | null = null

function supported(): boolean {
  return app.isPackaged && process.platform === 'darwin' && process.arch === 'arm64'
}

function fetchManifestBody(): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    let deadline: NodeJS.Timeout | null = null
    const clearDeadline = (): void => {
      if (deadline) clearTimeout(deadline)
      deadline = null
    }
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      clearDeadline()
      reject(error)
    }
    const resolveOnce = (body: string): void => {
      if (settled) return
      settled = true
      clearDeadline()
      resolve(body)
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
        response.on('error', (error) => rejectOnce(new UpdateNetworkError(error.message)))

        if (response.statusCode !== 200 || response.headers.location) {
          rejectOnce(
            new InvalidUpdateResponse('manifest response did not come from the expected URL')
          )
          response.destroy()
          request.destroy()
          return
        }
        const contentType = response.headers['content-type']?.toLowerCase() ?? ''
        if (!contentType.startsWith('application/json')) {
          rejectOnce(new InvalidUpdateResponse('manifest response is not JSON'))
          response.destroy()
          request.destroy()
          return
        }

        const declaredLength = response.headers['content-length']
        if (declaredLength !== undefined) {
          const bytes = Number(declaredLength)
          if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_MANIFEST_BYTES) {
            rejectOnce(
              new InvalidUpdateResponse('manifest body is outside the supported size')
            )
            response.destroy()
            request.destroy()
            return
          }
        }

        const chunks: Buffer[] = []
        let total = 0
        response.on('data', (chunk: Buffer) => {
          total += chunk.byteLength
          if (total > MAX_MANIFEST_BYTES) {
            rejectOnce(
              new InvalidUpdateResponse('manifest body is outside the supported size')
            )
            response.destroy()
            request.destroy()
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          if (settled) return
          if (!response.complete) {
            rejectOnce(new UpdateNetworkError('manifest response ended early'))
            return
          }
          if (total === 0) {
            rejectOnce(new InvalidUpdateResponse('manifest response has no body'))
            return
          }
          try {
            const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
            resolveOnce(body)
          } catch {
            rejectOnce(new InvalidUpdateResponse('manifest response is not valid UTF-8'))
          }
        })
      }
    )
    deadline = setTimeout(() => {
      request.destroy(new UpdateNetworkError('manifest request timed out'))
    }, CHECK_TIMEOUT_MS)
    request.on('error', (error) =>
      rejectOnce(
        error instanceof UpdateNetworkError ? error : new UpdateNetworkError(error.message)
      )
    )
  })
}

async function fetchRelease(): Promise<ValidatedUpdateRelease> {
  const body = await fetchManifestBody()
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new InvalidUpdateResponse('manifest response is not valid JSON')
  }
  try {
    return parseUpdateManifest(value)
  } catch (error) {
    throw new InvalidUpdateResponse((error as Error).message)
  }
}

function unavailableReason(error: unknown): 'network' | 'trust' | 'invalid-response' {
  if (error instanceof InvalidUpdateResponse) return 'invalid-response'
  const message = (error as Error).message ?? ''
  return /cert|certificate|err_ssl|self.signed|unable to verify|expired/i.test(message)
    ? 'trust'
    : 'network'
}

async function performCheck(): Promise<CheckResult> {
  const currentVersion = app.getVersion()
  const checkedAt = new Date().toISOString()
  try {
    const release = await fetchRelease()
    const status = statusForUpdateRelease(currentVersion, release, checkedAt)
    return { status, release }
  } catch (error) {
    const reason = unavailableReason(error)
    console.warn(`[updates] check failed (${reason}):`, (error as Error).message)
    return {
      status: { state: 'unavailable', currentVersion, reason, checkedAt }
    }
  }
}

function cacheIsFresh(entry: NonNullable<typeof cached>): boolean {
  const ttl = entry.result.status.state === 'unavailable' ? FAILURE_CACHE_MS : SUCCESS_CACHE_MS
  return Date.now() - entry.checkedAt < ttl
}

async function loadCheck(force: boolean): Promise<CheckResult> {
  if (!force && cached && cacheIsFresh(cached)) return cached.result
  if (inFlight) return inFlight

  inFlight = performCheck()
  try {
    const result = await inFlight
    cached = { checkedAt: Date.now(), result }
    return result
  } finally {
    inFlight = null
  }
}

export async function checkForAppUpdate(force = false): Promise<AppUpdateStatus> {
  const currentVersion = app.getVersion()
  if (!supported()) return { state: 'unsupported', currentVersion }
  return (await loadCheck(force)).status
}

export async function openAppUpdateDownload(): Promise<AppUpdateDownloadResult> {
  if (!supported()) {
    return { ok: false, error: 'Internal updates support macOS on Apple silicon.' }
  }

  const result = await loadCheck(false)
  if (result.status.state !== 'available' || !result.release) {
    const error =
      result.status.state === 'unavailable'
        ? 'The public update channel is unavailable. Connect to VPN and try again.'
        : 'No newer ClipThat release is available.'
    return { ok: false, error }
  }

  try {
    await shell.openExternal(result.release.downloadUrl)
    return { ok: true }
  } catch (error) {
    console.warn('[updates] could not open download:', (error as Error).message)
    return { ok: false, error: 'The update download could not be opened.' }
  }
}
