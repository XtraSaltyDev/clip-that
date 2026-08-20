import { app } from 'electron'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  type WriteStream
} from 'node:fs'
import { join } from 'node:path'
import { PRODUCT_VERSION } from './product-version'

/**
 * Mirrors console output to a file under userData.
 *
 * A packaged app launched from Finder has nowhere to send stdout, so the diagnostics that
 * matter most — permission state, which displays produced a snapshot, why an encode failed
 * — vanish exactly when someone is trying to report a problem. This keeps them.
 */

const MAX_BYTES = 1_000_000
const MAX_GENERATIONS = 3

let stream: WriteStream | null = null
let streamBytes = 0
let rotating = false
let loggerClosed = false
let pendingLines: string[] = []

export function logFilePath(): string {
  const dir = join(app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'clipthat.log')
}

function rotate(path: string): void {
  try {
    for (let generation = MAX_GENERATIONS - 1; generation >= 1; generation -= 1) {
      const from = generation === 1 ? path : `${path}.${generation - 1}`
      const to = `${path}.${generation}`
      if (!existsSync(from)) continue
      rmSync(to, { force: true })
      renameSync(from, to)
    }
  } catch {
    /* rotation is best-effort */
  }
}

function openStream(path: string): void {
  if (loggerClosed) return
  stream = createWriteStream(path, { flags: 'a' })
  streamBytes = existsSync(path) ? statSync(path).size : 0
  stream.on('error', () => {
    // Never let a logging failure take the app down.
    stream = null
    streamBytes = 0
  })
}

function finishRotation(path: string): void {
  if (loggerClosed) {
    pendingLines = []
    rotating = false
    return
  }
  rotate(path)
  openStream(path)
  rotating = false
  const queued = pendingLines
  pendingLines = []
  for (const line of queued) append(path, line)
}

function startRotation(path: string): void {
  if (rotating) return
  rotating = true
  const previous = stream
  stream = null
  streamBytes = 0
  if (previous) previous.end(() => finishRotation(path))
  else finishRotation(path)
}

function append(path: string, line: string): void {
  const bytes = Buffer.byteLength(line, 'utf8')
  if (rotating) {
    pendingLines.push(line)
    return
  }
  if (!stream) openStream(path)
  if (streamBytes + bytes > MAX_BYTES) {
    pendingLines.push(line)
    startRotation(path)
    return
  }
  stream?.write(line)
  streamBytes += bytes
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 23)

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

/** Tee console.log/warn/error into the log file. Safe to call once, at startup. */
export function installFileLogger(): void {
  if (stream) return

  loggerClosed = false
  const path = logFilePath()
  if (existsSync(path) && statSync(path).size > MAX_BYTES) rotate(path)
  openStream(path)

  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      append(path, `${stamp()} [${level}] ${format(args)}\n`)
    }
  }

  console.log(
    `[clipthat] ${app.getName()} ${PRODUCT_VERSION} — ${process.platform}/${process.arch}, ` +
      `electron ${process.versions.electron}, packaged=${app.isPackaged}`
  )
}

export function flushLog(): void {
  loggerClosed = true
  pendingLines = []
  stream?.end()
  stream = null
  streamBytes = 0
}
