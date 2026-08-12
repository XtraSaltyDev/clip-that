import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { desktopCapturer } from 'electron'
import type {
  LibraryItem,
  RecoverableRecording,
  RecordingOptions,
  RecordingState,
  RecordingStatus,
  VideoExportOptions
} from '@shared/types'
import { formatFilename } from '@shared/defaults'
import { settings } from '../store/settings'
import { library } from '../store/library'
import { recordingSessionsDir, recordingsDir } from '../store/paths'
import { toGif, toMp4, toWebm } from './ffmpeg'
import { RecordingRecoveryStore } from './recovery-store'
import { supportsSystemAudio } from './system-audio'

class RecordingSession extends EventEmitter {
  private state: RecordingState = 'idle'
  private options: RecordingOptions | null = null
  private startedAt = 0
  private accumulatedMs = 0
  private ticker: NodeJS.Timeout | null = null
  private rawPath: string | null = null
  private sessionId: string | null = null
  private recoveryStore: RecordingRecoveryStore | null = null
  private displayOverride: string | null = null

  status(): RecordingStatus {
    return {
      state: this.state,
      elapsedMs: this.elapsed(),
      options: this.options ?? undefined,
      sessionId: this.sessionId ?? undefined
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

  private async captureSource(): Promise<Electron.DesktopCapturerSource | undefined> {
    const override = this.displayOverride
    const opts = this.options
    if (!override && opts?.target === 'window') {
      if (!opts.windowId) return undefined
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 }
      })
      // Never silently fall back to a display when the selected window disappeared.
      // That produces a plausible video of the wrong content and breaks window-relative
      // auto-zoom geometry.
      return sources.find((source) => source.id === opts.windowId)
    }

    const sources = await this.getScreenSources()
    return this.sourceForDisplay(sources, override ?? opts?.displayId)
  }

  /**
   * Resolve the selected source before Chromium opens its media request. ScreenCaptureKit
   * can stall when desktopCapturer enumeration happens inside the getDisplayMedia handler;
   * the source ID path is the Electron-supported getUserMedia alternative.
   */
  async captureSourceId(): Promise<string> {
    const source = await this.captureSource()
    if (!source) throw new Error('The selected screen or window is no longer available.')
    return source.id
  }

  private sourceForDisplay(
    sources: Electron.DesktopCapturerSource[],
    displayId?: string
  ): Electron.DesktopCapturerSource | undefined {
    if (!displayId) return sources[0]
    return sources.find((source) => {
      if (source.display_id === displayId) return true
      const match = /^screen:(\d+):/.exec(source.id)
      return match?.[1] === displayId
    })
  }

  private getScreenSources(): Promise<Electron.DesktopCapturerSource[]> {
    return desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 }
    })
  }

  /** Warm ScreenCaptureKit discovery, but deliberately discard its short-lived handles. */
  async prewarmDisplaySources(): Promise<void> {
    await this.getScreenSources().then(
      () => undefined,
      () => undefined
    )
  }

  /** Temporarily route source-ID capture to the display selected for scrolling capture. */
  setDisplayOverride(displayId: string | null): void {
    this.displayOverride = displayId
  }

  systemAudioSupported(): boolean {
    return supportsSystemAudio(process.platform, process.getSystemVersion())
  }

  configure(options: RecordingOptions): RecordingOptions {
    this.options = { ...options }
    settings.set({ recording: this.options })
    return this.options
  }

  async initializeRecovery(): Promise<void> {
    const store = new RecordingRecoveryStore(recordingSessionsDir())
    await store.initialize()
    this.recoveryStore = store
  }

  recoveries(): RecoverableRecording[] {
    return this.store().list()
  }

  ownsRawPath(filePath: string): boolean {
    return this.recoveryStore?.ownsRawPath(filePath) ?? false
  }

  async beginCountdown(options: RecordingOptions): Promise<void> {
    if (this.state !== 'idle') throw new Error('A recording is already active')
    const configured = this.configure(options)
    this.accumulatedMs = 0
    const recovery = await this.store().create(configured)
    this.sessionId = recovery.id
    this.rawPath = recovery.rawPath
    this.setState('countdown')
  }

  async markStarted(): Promise<void> {
    if (this.state !== 'countdown') return
    this.startedAt = Date.now()
    this.accumulatedMs = 0
    this.setState('recording')
    await this.checkpoint({ state: 'recording' })
    this.ticker = setInterval(() => this.emit('status', this.status()), 500)
  }

  async pause(): Promise<void> {
    if (this.state !== 'recording') return
    this.accumulatedMs += Date.now() - this.startedAt
    this.setState('paused')
    await this.checkpoint({ durationMs: Math.max(1, this.accumulatedMs) })
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return
    this.startedAt = Date.now()
    this.setState('recording')
    await this.checkpoint({ state: 'recording' })
  }

  markStopping(): void {
    if (this.state !== 'recording' && this.state !== 'paused') return
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
    this.sessionId = null
    this.options = null
    this.setState('idle')
  }

  /** Append one MediaRecorder timeslice to the main-process-owned raw file. */
  async appendChunk(
    sessionId: string,
    sequence: number,
    bytes: Uint8Array,
    mimeType: string
  ): Promise<void> {
    if (sessionId !== this.sessionId) throw new Error('Recording session is no longer active')
    if (!['countdown', 'recording', 'paused', 'encoding'].includes(this.state)) {
      throw new Error('Recording is not accepting video data')
    }
    await this.store().append(sessionId, sequence, bytes, mimeType, Math.max(1, this.elapsed()))
  }

  /** Flush the append queue and make the durable raw file available for review/export. */
  async finalize(meta: {
    width: number
    height: number
    mimeType: string
  }): Promise<RecoverableRecording> {
    if (this.state !== 'encoding' || !this.sessionId) {
      throw new Error('No recording is ready to finalize')
    }
    const recovery = await this.store().update(this.sessionId, {
      state: 'ready',
      width: meta.width,
      height: meta.height,
      durationMs: Math.max(1, this.accumulatedMs),
      mimeType: meta.mimeType
    })
    if (recovery.byteSize === 0) throw new Error('The recording did not produce any video data')
    this.rawPath = recovery.rawPath
    return recovery
  }

  async preserveFailure(message: string): Promise<RecoverableRecording | null> {
    if (!this.sessionId) return null
    if (this.state === 'recording' || this.state === 'paused') this.markStopping()
    else if (this.state === 'countdown') this.setState('encoding')
    return this.store().update(this.sessionId, {
      state: 'failed',
      durationMs: Math.max(1, this.accumulatedMs),
      failure: message
    })
  }

  async recover(id: string): Promise<RecoverableRecording> {
    if (this.state !== 'idle') throw new Error('Finish the active recording first')
    const recovery = this.store().get(id)
    if (!recovery || recovery.byteSize === 0) throw new Error('Recovery recording was not found')
    this.sessionId = recovery.id
    this.rawPath = recovery.rawPath
    this.options = { ...recovery.options }
    this.accumulatedMs = recovery.durationMs ?? 0
    this.setState('encoding')
    return recovery
  }

  async discardRecovery(id: string): Promise<void> {
    if (id === this.sessionId) this.reset()
    await this.store().remove(id)
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
    if (this.state !== 'encoding') throw new Error('No recording is ready to export')
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

    if (this.sessionId) await this.store().remove(this.sessionId)
    this.reset()
    return item
  }

  async discard(): Promise<void> {
    if (this.sessionId) await this.store().remove(this.sessionId)
    this.reset()
  }

  private store(): RecordingRecoveryStore {
    if (!this.recoveryStore) throw new Error('Recording recovery store is not initialized')
    return this.recoveryStore
  }

  private async checkpoint(patch: Parameters<RecordingRecoveryStore['update']>[1]): Promise<void> {
    if (this.sessionId) await this.store().update(this.sessionId, patch)
  }
}

export const recording = new RecordingSession()
