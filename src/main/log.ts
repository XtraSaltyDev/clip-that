import { app } from 'electron'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'

/**
 * Mirrors console output to a file under userData.
 *
 * A packaged app launched from Finder has nowhere to send stdout, so the diagnostics that
 * matter most — permission state, which displays produced a snapshot, why an encode failed
 * — vanish exactly when someone is trying to report a problem. This keeps them.
 */

const MAX_BYTES = 1_000_000

let stream: WriteStream | null = null

export function logFilePath(): string {
  const dir = join(app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'clipthat.log')
}

function rotate(path: string): void {
  try {
    if (existsSync(path) && statSync(path).size > MAX_BYTES) {
      renameSync(path, `${path}.1`)
    }
  } catch {
    /* rotation is best-effort */
  }
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

  const path = logFilePath()
  rotate(path)
  stream = createWriteStream(path, { flags: 'a' })
  stream.on('error', () => {
    // Never let a logging failure take the app down.
    stream = null
  })

  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      stream?.write(`${stamp()} [${level}] ${format(args)}\n`)
    }
  }

  console.log(
    `[clipthat] ${app.getName()} ${app.getVersion()} — ${process.platform}/${process.arch}, ` +
      `electron ${process.versions.electron}, packaged=${app.isPackaged}`
  )
}

export function flushLog(): void {
  stream?.end()
  stream = null
}
