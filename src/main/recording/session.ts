import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { desktopCapturer, session as electronSession } from 'electron'
import type {
  LibraryItem,
  RecordingOptions,
  RecordingState,
  RecordingStatus,
  VideoExportOptions
} from '@shared/types'
import { formatFilename } from '@shared/defaults'
import { settings } from '../store/settings'
import { library } from '../store/library'
import { recordingsDir, tempDir } from '../store/paths'
import { toGif, toMp4, toWebm } from './ffmpeg'
import { displayPixelSize, findDisplay } from '../capture/displays'

const IS_WIN = process.platform === 'win32'
const IS_LINUX = process.platform === 'linux'

class RecordingSession extends EventEmitter {
  private state: RecordingState = 'idle'
  private options: RecordingOptions | null = null
  private startedAt = 0
  private accumulatedMs = 0
  private ticker: NodeJS.Timeout | null = null
  private rawPath: string | null = null

  status(): RecordingStatus {
    return {
      state: this.state,
      elapsedMs: this.elapsed(),
      options: this.options ?? undefined
    }
  }

  private elapsed(): number {
    if (this.state === 'recording') return this.accumulatedMs + (Date.now() - this.startedAt)
    return this.accumulatedMs
  }

  private setState(state: RecordingState): void {
    this.state = state
    this.emit('status', this.status())
  }

  /**
   * Tell Chromium which source to hand `getDisplayMedia`, so the renderer never
   * sees the OS picker. Called once at startup.
   */
  installDisplayMediaHandler(): void {
    electronSession.defaultSession.setDisplayMediaRequestHandler(
      (_request, callback) => {
        void (async () => {
          const opts = this.options
          if (!opts) {
            callback({})
            return
          }

          try {
            if (opts.target === 'window' && opts.windowId) {
              const sources = await desktopCapturer.getSources({
                types: ['window'],
                thumbnailSize: { width: 0, height: 0 }
              })
              const source = sources.find((s) => s.id === opts.windowId)
              if (source) {
                callback({ video: source, audio: this.audioChoice(opts) })
                return
              }
            }

            const displayId = opts.displayId
            const display = displayId ? findDisplay(displayId) : undefined
            const size = display ? displayPixelSize(display) : { width: 1920, height: 1080 }
            const sources = await desktopCapturer.getSources({
              types: ['screen'],
              thumbnailSize: { width: Math.min(320, size.width), height: 180 }
            })
            const source =
              sources.find((s) => s.display_id === displayId) ?? sources[0]
            callback(source ? { video: source, audio: this.audioChoice(opts) } : {})
          } catch {
            callback({})
          }
        })()
      },
      // Without this the handler is treated as a one-shot on some platforms.
      { useSystemPicker: false }
    )
  }

  /**
   * Chromium can only loop back system audio on Windows and (via PipeWire) Linux.
   * macOS has no supported route without a virtual audio device, so we quietly
   * fall back to no system audio there and the UI says so.
   */
  private audioChoice(opts: RecordingOptions): 'loopback' | undefined {
    if (!opts.systemAudio) return undefined
    return IS_WIN || IS_LINUX ? 'loopback' : undefined
  }

  systemAudioSupported(): boolean {
    return IS_WIN || IS_LINUX
  }

  configure(options: RecordingOptions): RecordingOptions {
    this.options = { ...options }
    settings.set({ recording: this.options })
    return this.options
  }

  beginCountdown(options: RecordingOptions): void {
    this.configure(options)
    this.accumulatedMs = 0
    this.setState('countdown')
  }

  markStarted(): void {
    this.startedAt = Date.now()
    this.accumulatedMs = 0
    this.setState('recording')
    this.ticker = setInterval(() => this.emit('status', this.status()), 500)
  }

  pause(): void {
    if (this.state !== 'recording') return
    this.accumulatedMs += Date.now() - this.startedAt
    this.setState('paused')
  }

  resume(): void {
    if (this.state !== 'paused') return
    this.startedAt = Date.now()
    this.setState('recording')
  }

  markStopping(): void {
    if (this.state === 'recording') this.accumulatedMs += Date.now() - this.startedAt
    if (this.ticker) {
      clearInterval(this.ticker)
      this.ticker = null
    }
    this.setState('encoding')
  }

  reset(): void {
    if (this.ticker) {
      clearInterval(this.ticker)
      this.ticker = null
    }
    this.accumulatedMs = 0
    this.rawPath = null
    this.setState('idle')
  }

  /** Persist the raw WebM the renderer's MediaRecorder produced. */
  async saveRaw(bytes: Uint8Array): Promise<string> {
    const path = join(tempDir(), `recording-${randomUUID()}.webm`)
    await fs.writeFile(path, Buffer.from(bytes))
    this.rawPath = path
    return path
  }

  rawFile(): string | null {
    return this.rawPath
  }

  /** Encode the raw capture into the requested delivery format and index it. */
  async export(
    opts: VideoExportOptions,
    meta: { width: number; height: number; durationMs: number; posterDataUrl?: string },
    onProgress?: (percent: number) => void
  ): Promise<LibraryItem | null> {
    const input = this.rawPath
    if (!input) return null

    const name = formatFilename(settings.get().filenameTemplate)
    const output = join(recordingsDir(), `${randomUUID()}.${opts.format}`)
    const total = (opts.endMs ?? meta.durationMs) - (opts.startMs ?? 0)

    const progress = (p: { percent: number }) => onProgress?.(p.percent)

    try {
      if (opts.format === 'mp4') await toMp4(input, output, opts, total, progress)
      else if (opts.format === 'gif') await toGif(input, output, opts, total, progress)
      else await toWebm(input, output, opts, total, progress)
    } catch (err) {
      this.emit('error', err)
      throw err
    }

    const item = await library.addVideo({
      filePath: output,
      title: name,
      width: meta.width,
      height: meta.height,
      durationMs: total,
      posterDataUrl: meta.posterDataUrl
    })

    await fs.rm(input, { force: true }).catch(() => {})
    this.rawPath = null
    this.reset()
    return item
  }

  async discard(): Promise<void> {
    if (this.rawPath) await fs.rm(this.rawPath, { force: true }).catch(() => {})
    this.rawPath = null
    this.reset()
  }
}

export const recording = new RecordingSession()
