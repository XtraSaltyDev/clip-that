import React, { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DisplayInfo,
  PlatformCapability,
  RecoverableRecording,
  RecordingOptions,
  RecordingPreflight,
  VideoExportOptions,
  WindowInfo
} from '@shared/types'
import { DEFAULT_RECORDING } from '@shared/defaults'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import { Segmented, Slider, Toggle, formatDuration, useTheme } from '../shared/ui'
import {
  checkRecordingDevices,
  listDevices,
  posterFromUrl,
  startMicrophoneMonitor,
  startCapture,
  type CaptureHandles
} from './pipeline'
import { reconcileRecordingSources } from './recording-sources'
import { capabilityStateLabel, recordingReadiness } from './preflight-summary'
import './hud.css'

type Phase = 'setup' | 'recovery' | 'countdown' | 'recording' | 'review' | 'encoding'

const SIZES: Record<Phase, [number, number]> = {
  setup: [460, 720],
  recovery: [520, 420],
  countdown: [260, 260],
  recording: [332, 60],
  review: [620, 560],
  encoding: [360, 140]
}

export default function Recorder(): React.ReactElement {
  useTheme()
  const [phase, setPhase] = useState<Phase>('setup')
  const [options, setOptions] = useState<RecordingOptions>(DEFAULT_RECORDING)
  const [sources, setSources] = useState<{
    displays: DisplayInfo[]
    windows: WindowInfo[]
    systemAudioSupported: boolean
    media: {
      ffmpeg: boolean
      ffprobe: boolean
      encoders: string[]
      mp4: boolean
      webm: boolean
      gif: boolean
    }
    capabilities: PlatformCapability[]
  } | null>(null)
  const [preflight, setPreflight] = useState<RecordingPreflight | null>(null)
  const [preflightBusy, setPreflightBusy] = useState(true)
  const [microphoneLevel, setMicrophoneLevel] = useState(0)
  const [microphoneMonitorError, setMicrophoneMonitorError] = useState<string | null>(null)
  const [devices, setDevices] = useState<{
    microphones: MediaDeviceInfo[]
    cameras: MediaDeviceInfo[]
  }>({
    microphones: [],
    cameras: []
  })
  const [count, setCount] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  const [recoveries, setRecoveries] = useState<RecoverableRecording[]>([])
  const [activeRecovery, setActiveRecovery] = useState<RecoverableRecording | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [trim, setTrim] = useState<[number, number]>([0, 0])
  const [format, setFormat] = useState<VideoExportOptions['format']>('mp4')
  const [quality, setQuality] = useState<VideoExportOptions['quality']>('high')
  const isWindows = navigator.userAgent.includes('Windows')

  const capture = useRef<CaptureHandles | null>(null)
  const startedAt = useRef(0)
  const pausedFor = useRef(0)
  const pausedAt = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const countdownRun = useRef(0)

  /* ---------- window sizing follows the phase ---------- */

  useEffect(() => {
    const [w, h] = SIZES[phase]
    if (phase === 'recording' || phase === 'countdown') api.hud.dock(w, h)
    else api.hud.resize(w, h)
  }, [phase])

  /* ---------- data ---------- */

  useEffect(() => {
    void Promise.all([api.recording.sources(), api.settings.get()]).then(([sourceList, result]) => {
      setSources(sourceList)
      setOptions((current) =>
        reconcileRecordingSources(
          { ...current, ...result.settings.recording },
          sourceList.displays,
          sourceList.windows
        )
      )
    })
    void listDevices().then((next) => {
      setDevices(next)
      setOptions((current) => ({
        ...current,
        microphone: next.microphones.length > 0 && current.microphone,
        webcam: next.cameras.length > 0 && current.webcam
      }))
    })
    void api.recording.recoveries().then((items) => {
      setRecoveries(items)
      if (items.length > 0) setPhase('recovery')
    })
  }, [])

  useEffect(() => api.recording.onProgress(({ percent }) => setProgress(percent)), [])

  useEffect(() => {
    if (!sources || phase !== 'setup') return
    const timer = setTimeout(() => void api.recording.configure(options), 250)
    return () => clearTimeout(timer)
  }, [options, phase, sources])

  useEffect(() => {
    if (!options.microphone || phase !== 'setup') {
      setMicrophoneLevel(0)
      setMicrophoneMonitorError(null)
      return
    }
    let dispose: (() => void) | undefined
    let active = true
    setMicrophoneMonitorError(null)
    void startMicrophoneMonitor(options.microphoneDeviceId, setMicrophoneLevel, (message) => {
      if (active) setMicrophoneMonitorError(message)
    }).then((next) => {
      if (active) dispose = next
      else next()
    })
    return () => {
      active = false
      dispose?.()
    }
  }, [options.microphone, options.microphoneDeviceId, phase])

  useEffect(() => {
    if (!sources) return
    let active = true
    setPreflightBusy(true)
    const timer = setTimeout(() => {
      void Promise.all([api.recording.preflight(options), checkRecordingDevices(options)])
        .then(([main, devices]) => {
          if (!active) return
          const items = [...main.items, ...devices]
          setPreflight({
            ...main,
            items,
            canStart: main.canStart && devices.every((item) => item.state === 'supported')
          })
        })
        .catch((err) => {
          if (active) setError((err as Error).message || 'Recording preflight failed')
        })
        .finally(() => {
          if (active) setPreflightBusy(false)
        })
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [options, sources])

  /* ---------- elapsed ticker ---------- */

  useEffect(() => {
    if (phase !== 'recording' || paused) return
    const id = setInterval(() => {
      setElapsed(Date.now() - startedAt.current - pausedFor.current)
    }, 200)
    return () => clearInterval(id)
  }, [phase, paused])

  /* ---------- start / stop ---------- */

  const beginRecording = useCallback(async () => {
    const run = ++countdownRun.current
    setError(null)
    if (!preflight?.canStart) {
      setError('Resolve the unavailable recording checks before starting.')
      return
    }
    await api.recording.configure(options)

    if (options.countdown > 0) {
      setPhase('countdown')
      setCount(options.countdown)
      for (let i = options.countdown; i > 0; i--) {
        setCount(i)
        await new Promise((r) => setTimeout(r, 1000))
        if (run !== countdownRun.current) return
      }
    }

    try {
      const status = await api.recording.start(options)
      if (!status.sessionId) throw new Error('Recording session did not start')
      const handles = await startCapture(options, options.region, (sequence, bytes, mimeType) =>
        api.recording.appendChunk(status.sessionId!, sequence, bytes, mimeType)
      )
      capture.current = handles
      startedAt.current = Date.now()
      pausedFor.current = 0
      setElapsed(0)
      setPaused(false)
      setPhase('recording')
      await api.recording.started()
    } catch (err) {
      capture.current?.dispose()
      capture.current = null
      setError((err as Error).message || 'Screen capture was refused')
      setPhase('setup')
      await api.recording.cancel()
    }
  }, [options, preflight?.canStart])

  const finishRecording = useCallback(async () => {
    const handles = capture.current
    if (!handles) return
    capture.current = null
    try {
      await api.recording.stop()
      await handles.stop()
      const recovery = await api.recording.finalize({
        width: handles.width,
        height: handles.height,
        mimeType: handles.mimeType
      })
      setActiveRecovery(recovery)
      setMediaUrl(api.library.fileUrl(recovery.rawPath))
      setPhase('review')
    } catch (err) {
      const message = (err as Error).message || 'Could not finish the recording'
      const recovery = await api.recording.preserveFailure(message).catch(() => null)
      if (recovery && recovery.byteSize > 0) {
        setError(`${message}. The raw recording was preserved.`)
        setActiveRecovery(recovery)
        setMediaUrl(api.library.fileUrl(recovery.rawPath))
        setPhase('review')
      } else {
        setError(message)
        setPhase('setup')
      }
    }
  }, [])

  // The OS can end capture from its sharing indicator or when the source disappears.
  // Treat that exactly like the Stop button so the main-process session cannot get stuck.
  useEffect(() => {
    const handles = capture.current
    if (phase !== 'recording' || !handles) return
    const onEnded = () => {
      if (capture.current !== handles) return
      setError(
        'The selected source or device ended. The recording was stopped so it cannot silently switch content.'
      )
      void finishRecording()
    }
    handles.sourceTrack.addEventListener('ended', onEnded, { once: true })
    handles.recorder.addEventListener('stop', onEnded, { once: true })
    return () => {
      handles.sourceTrack.removeEventListener('ended', onEnded)
      handles.recorder.removeEventListener('stop', onEnded)
    }
  }, [finishRecording, phase])

  const cancelRecording = useCallback(async () => {
    countdownRun.current += 1
    capture.current?.dispose()
    capture.current = null
    await api.recording.cancel()
    api.hud.close()
  }, [])

  const togglePause = useCallback(() => {
    const recorder = capture.current?.recorder
    if (!recorder) return
    if (recorder.state === 'recording') {
      recorder.pause()
      capture.current?.setPaused(true)
      pausedAt.current = Date.now()
      setPaused(true)
      void api.recording.pause()
    } else if (recorder.state === 'paused') {
      capture.current?.setPaused(false)
      recorder.resume()
      pausedFor.current += Date.now() - pausedAt.current
      setPaused(false)
      void api.recording.resume()
    }
  }, [])

  /* ---------- commands from the tray / global hotkey ---------- */

  useEffect(
    () =>
      api.recording.onCommand(({ command }) => {
        if (command === 'stop') void finishRecording()
        else if (command === 'cancel') void cancelRecording()
        else if (command === 'pause' || command === 'resume') {
          /* driven locally; main only mirrors the state */
        }
      }),
    [finishRecording, cancelRecording]
  )

  /* ---------- review ---------- */

  useEffect(() => {
    if (!mediaUrl || !videoRef.current) return
    const video = videoRef.current
    const onMeta = () => {
      // WebM from MediaRecorder often reports Infinity until it's seeked to the end.
      if (!Number.isFinite(video.duration)) {
        video.currentTime = 1e101
        return
      }
      const ms = video.duration * 1000
      setDuration(ms)
      setTrim([0, ms])
      video.currentTime = 0
    }
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('durationchange', onMeta)
    return () => {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('durationchange', onMeta)
    }
  }, [mediaUrl])

  const saveRecording = useCallback(async () => {
    if (!mediaUrl) return
    setPhase('encoding')
    setProgress(0)
    const poster = await posterFromUrl(mediaUrl, trim[0] + 200)
    const knownDuration = Math.max(1, duration, activeRecovery?.durationMs ?? 0)
    const hasTrim = trim[1] > trim[0]
    const item = await api.recording.export(
      {
        format,
        quality,
        startMs: hasTrim ? trim[0] : undefined,
        endMs: hasTrim ? trim[1] : undefined,
        fps: format === 'gif' ? 15 : options.fps,
        maxWidth: format === 'gif' ? 900 : undefined
      },
      {
        width: videoRef.current?.videoWidth || activeRecovery?.width || 1920,
        height: videoRef.current?.videoHeight || activeRecovery?.height || 1080,
        durationMs: knownDuration,
        posterDataUrl: poster
      }
    )
    if (item) api.hud.close()
    else {
      setError('Encoding failed. The raw recording is still available to retry.')
      setPhase('review')
    }
  }, [activeRecovery, duration, format, mediaUrl, quality, trim])

  const discard = useCallback(async () => {
    await api.recording.cancel()
    api.hud.close()
  }, [])

  const openRecovery = useCallback(async (item: RecoverableRecording) => {
    setError(item.failure ? `Previous export failed: ${item.failure}` : null)
    const recovery = await api.recording.recover(item.id)
    setActiveRecovery(recovery)
    setOptions(recovery.options)
    setDuration(recovery.durationMs ?? 0)
    if (recovery.durationMs) setTrim([0, recovery.durationMs])
    setMediaUrl(api.library.fileUrl(recovery.rawPath))
    setPhase('review')
  }, [])

  const removeRecovery = useCallback(async (id: string) => {
    const remaining = await api.recording.discardRecovery(id)
    setRecoveries(remaining)
    if (remaining.length === 0) setPhase('setup')
  }, [])

  /* ------------------------------------------------------------------ */

  if (phase === 'countdown') {
    return (
      <div className="hud-count">
        <div className="hud-count-ring">
          <span>{count}</span>
        </div>
        <button className="btn sm ghost" onClick={() => void cancelRecording()}>
          Cancel
        </button>
      </div>
    )
  }

  if (phase === 'recording') {
    return (
      <div className="hud-bar drag-region">
        <span className={`hud-rec ${paused ? 'paused' : ''}`} />
        <span className="hud-recording-state" role="status" aria-live="polite">
          {paused ? 'Paused' : 'Recording'}
        </span>
        <span className="hud-time mono" aria-live="off">
          {formatDuration(elapsed)}
        </span>
        <span className="spacer" />
        <button
          className="hud-btn no-drag"
          onClick={togglePause}
          title={paused ? 'Resume' : 'Pause'}
          aria-label={paused ? 'Resume recording' : 'Pause recording'}
        >
          <Icon name={paused ? 'play' : 'pause'} size={15} />
        </button>
        <button
          className="hud-btn stop no-drag"
          onClick={() => void finishRecording()}
          title="Stop and review"
          aria-label="Stop and review recording"
        >
          <Icon name="stop" size={15} />
        </button>
        <button
          className="hud-btn no-drag"
          onClick={() => void cancelRecording()}
          title="Discard"
          aria-label="Discard recording"
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
    )
  }

  if (phase === 'encoding') {
    return (
      <div className="hud-card hud-encoding">
        <Icon name="refresh" size={20} className="spin" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Encoding {format.toUpperCase()}…</div>
          <div className="hud-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
        <button className="btn ghost" onClick={() => void api.recording.cancelExport()}>
          Cancel
        </button>
      </div>
    )
  }

  if (phase === 'recovery') {
    return (
      <div className="hud-card hud-recovery">
        <header className="drag-region">
          <Icon name="video" size={16} />
          <h1>Recover recordings</h1>
          <span className="spacer" />
          <button
            className="btn ghost icon no-drag"
            aria-label="Close recovery"
            onClick={() => api.hud.close()}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="hud-recovery-list">
          <p className="tiny muted">
            These raw recordings survived an interruption or failed export.
          </p>
          {recoveries.map((item) => (
            <div className="hud-recovery-item" key={item.id}>
              <div>
                <strong>{new Date(item.createdAt).toLocaleString()}</strong>
                <div className="tiny muted">
                  {(item.byteSize / 1024 / 1024).toFixed(1)} MB
                  {item.durationMs ? ` · ${formatDuration(item.durationMs)}` : ''}
                  {item.state === 'failed' ? ' · export failed' : ' · interrupted'}
                </div>
              </div>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => void removeRecovery(item.id)}>
                Discard
              </button>
              <button className="btn primary" onClick={() => void openRecovery(item)}>
                Review
              </button>
            </div>
          ))}
        </div>
        <footer>
          <span className="spacer" />
          <button className="btn" onClick={() => setPhase('setup')}>
            Record new
          </button>
        </footer>
      </div>
    )
  }

  if (phase === 'review') {
    const selectedEncoderAvailable = Boolean(sources?.media[format])
    return (
      <div className="hud-card hud-review">
        <header className="drag-region">
          <Icon name="video" size={16} />
          <h1>{activeRecovery?.state === 'failed' ? 'Recover recording' : 'Review recording'}</h1>
          <span className="spacer" />
          <button
            className="btn ghost icon no-drag"
            aria-label="Discard recording"
            onClick={() => void discard()}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="hud-video">
          {mediaUrl && <video ref={videoRef} src={mediaUrl} controls preload="metadata" />}
        </div>

        <div className="hud-trim">
          <div className="row tiny muted">
            <span>Trim</span>
            <span className="spacer" />
            <span className="mono">
              {formatDuration(trim[0])} → {formatDuration(trim[1])} ·{' '}
              {formatDuration(Math.max(0, trim[1] - trim[0]))}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            value={trim[0]}
            onChange={(e) => {
              const v = Math.min(Number(e.target.value), trim[1] - 200)
              setTrim([v, trim[1]])
              if (videoRef.current) videoRef.current.currentTime = v / 1000
            }}
          />
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            value={trim[1]}
            onChange={(e) => {
              const v = Math.max(Number(e.target.value), trim[0] + 200)
              setTrim([trim[0], v])
              if (videoRef.current) videoRef.current.currentTime = v / 1000
            }}
          />
        </div>

        <div className="hud-row">
          <span className="label">Format</span>
          <Segmented
            value={format}
            options={[
              {
                value: 'mp4',
                label: 'MP4',
                disabled: !sources?.media.mp4,
                tip: sources?.media.mp4 ? undefined : 'MP4 encoder unavailable'
              },
              {
                value: 'gif',
                label: 'GIF',
                disabled: !sources?.media.gif,
                tip: sources?.media.gif ? undefined : 'GIF encoder unavailable'
              },
              {
                value: 'webm',
                label: 'WebM',
                disabled: !sources?.media.webm,
                tip: sources?.media.webm ? undefined : 'WebM encoder unavailable'
              }
            ]}
            onChange={setFormat}
          />
          <span className="spacer" />
          <span className="label">Quality</span>
          <Segmented
            value={quality}
            options={[
              { value: 'low', label: 'Small' },
              { value: 'medium', label: 'Balanced' },
              { value: 'high', label: 'Best' }
            ]}
            onChange={setQuality}
          />
        </div>

        {error && <div className="hud-error">{error}</div>}
        {!selectedEncoderAvailable && (
          <div className="hud-error">
            The bundled FFmpeg package cannot encode {format.toUpperCase()} on this machine. Choose
            a format whose encoder passed preflight.
          </div>
        )}

        <footer>
          <button className="btn ghost" onClick={discard}>
            Discard
          </button>
          <span className="spacer" />
          <button
            className="btn primary"
            disabled={!selectedEncoderAvailable}
            onClick={() => void saveRecording()}
          >
            <Icon name="download" size={14} /> Save {format.toUpperCase()}
          </button>
        </footer>
      </div>
    )
  }

  /* ---------- setup ---------- */

  const set = (patch: Partial<RecordingOptions>) => setOptions((o) => ({ ...o, ...patch }))
  const readiness = recordingReadiness(
    preflight?.items ?? [],
    Boolean(preflight?.canStart),
    preflightBusy
  )
  const copySupportSummary = () => {
    const lines = [
      `ClipThat ${navigator.userAgent.includes('Windows') ? 'Windows unsigned experimental preview' : 'recording support summary'}`,
      ...(preflight?.items ?? []).map((item) => `${item.label}: ${item.state} — ${item.detail}`),
      ...(sources?.capabilities ?? []).map(
        (item) => `${item.label}: ${item.state} — ${item.detail}`
      )
    ]
    void navigator.clipboard.writeText(lines.join('\n'))
  }

  return (
    <div className="hud-card hud-setup">
      <header className="drag-region">
        <Icon name="video" size={16} />
        <h1>Record screen</h1>
        <span className="spacer" />
        <button
          className="btn ghost icon no-drag"
          aria-label="Close recording setup"
          onClick={() => api.hud.close()}
        >
          <Icon name="close" />
        </button>
      </header>

      <div className="hud-scroll">
        <div className="hud-field">
          <span className="label">Capture</span>
          <Segmented
            value={options.target}
            options={[
              { value: 'display', label: 'Screen' },
              { value: 'window', label: 'Window' },
              { value: 'region', label: 'Region' }
            ]}
            onChange={(target) => set({ target })}
          />
        </div>

        {options.target === 'display' && (
          <div className="hud-field">
            <span className="label">Screen</span>
            <select
              className="field"
              value={options.displayId ?? ''}
              onChange={(e) => set({ displayId: e.target.value })}
            >
              {sources?.displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} — {d.bounds.width}×{d.bounds.height}
                  {d.primary ? ' (primary)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {options.target === 'window' && (
          <div className="hud-field">
            <span className="label">Window</span>
            <select
              className="field"
              value={options.windowId ?? ''}
              onChange={(e) => set({ windowId: e.target.value })}
            >
              <option value="">Choose a window…</option>
              {sources?.windows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.appName} — {w.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {options.target === 'region' && (
          <div className="hud-field">
            <span className="label">Region</span>
            <button
              className="btn"
              onClick={() => {
                void api.recording.selectRegion().then((selection) => {
                  if (selection) set({ displayId: selection.displayId, region: selection.region })
                })
              }}
            >
              {options.region
                ? `Change ${Math.round(options.region.width)}×${Math.round(options.region.height)} region`
                : 'Select region…'}
            </button>
          </div>
        )}

        <div className="hud-field">
          <span className="label">Frame rate</span>
          <Segmented
            value={String(options.fps)}
            options={[
              { value: '15', label: '15' },
              { value: '24', label: '24' },
              { value: '30', label: '30' },
              { value: '60', label: '60' }
            ]}
            onChange={(v) => set({ fps: Number(v) as RecordingOptions['fps'] })}
          />
        </div>

        <div className="divider" />

        <Toggle
          label="Microphone"
          hint={devices.microphones[0]?.label || 'No microphone is currently available'}
          disabled={devices.microphones.length === 0}
          checked={options.microphone && devices.microphones.length > 0}
          onChange={(microphone) => set({ microphone })}
        />
        {options.microphone && devices.microphones.length > 1 && (
          <select
            className="field"
            value={options.microphoneDeviceId ?? ''}
            onChange={(e) => set({ microphoneDeviceId: e.target.value })}
          >
            <option value="">System default</option>
            {devices.microphones.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Microphone'}
              </option>
            ))}
          </select>
        )}
        {options.microphone && (
          <div
            className="hud-mic-level"
            aria-label={`Microphone level ${Math.round(microphoneLevel * 100)} percent`}
          >
            <span style={{ width: `${Math.round(microphoneLevel * 100)}%` }} />
          </div>
        )}
        {microphoneMonitorError && (
          <div className="tiny hud-device-error">{microphoneMonitorError}</div>
        )}

        <Toggle
          label="System audio"
          hint={
            sources?.systemAudioSupported
              ? isWindows
                ? 'Capture Windows playback audio — verified when recording starts'
                : 'Capture what the computer plays — macOS may ask on first use'
              : 'System audio capture is unavailable on this platform'
          }
          disabled={!sources?.systemAudioSupported}
          checked={options.systemAudio && Boolean(sources?.systemAudioSupported)}
          onChange={(systemAudio) => set({ systemAudio })}
        />

        <Toggle
          label="Webcam bubble"
          hint={devices.cameras[0]?.label || 'No camera is currently available'}
          disabled={devices.cameras.length === 0}
          checked={options.webcam && devices.cameras.length > 0}
          onChange={(webcam) => set({ webcam })}
        />
        {options.webcam && (
          <>
            {devices.cameras.length > 1 && (
              <select
                className="field"
                value={options.webcamDeviceId ?? ''}
                onChange={(e) => set({ webcamDeviceId: e.target.value })}
              >
                <option value="">System default</option>
                {devices.cameras.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Camera'}
                  </option>
                ))}
              </select>
            )}
            <div className="hud-field">
              <span className="label">Position</span>
              <Segmented
                value={options.webcamPosition}
                options={[
                  { value: 'tl', label: '◤', ariaLabel: 'Top left' },
                  { value: 'tr', label: '◥', ariaLabel: 'Top right' },
                  { value: 'bl', label: '◣', ariaLabel: 'Bottom left' },
                  { value: 'br', label: '◢', ariaLabel: 'Bottom right' }
                ]}
                onChange={(webcamPosition) => set({ webcamPosition })}
              />
            </div>
            <Slider
              label="Bubble size"
              value={options.webcamSize}
              min={120}
              max={420}
              suffix="px"
              onChange={(webcamSize) => set({ webcamSize })}
            />
          </>
        )}

        <Toggle
          label="Auto-zoom"
          hint={
            options.target === 'region'
              ? 'Auto-zoom is available for Screen and Window recordings'
              : 'A smooth camera follows your cursor, like a produced video'
          }
          checked={options.autoZoom}
          disabled={options.target === 'region'}
          onChange={(autoZoom) => set({ autoZoom })}
        />
        {options.autoZoom && options.target !== 'region' && (
          <Slider
            label="Zoom level"
            value={options.zoomLevel}
            min={1.2}
            max={2.5}
            step={0.1}
            suffix="×"
            onChange={(zoomLevel) => set({ zoomLevel })}
          />
        )}

        <div className="divider" />

        <Slider
          label="Countdown"
          value={options.countdown}
          min={0}
          max={10}
          suffix="s"
          onChange={(countdown) => set({ countdown })}
        />

        <div className="hud-readiness" data-tone={readiness.tone} role="status" aria-live="polite">
          <span className="hud-readiness-mark" aria-hidden="true">
            <Icon
              name={
                readiness.tone === 'ready'
                  ? 'check'
                  : readiness.tone === 'checking'
                    ? 'refresh'
                    : 'alert'
              }
              className={readiness.tone === 'checking' ? 'spin' : undefined}
              size={15}
            />
          </span>
          <span className="hud-readiness-copy">
            <strong>{readiness.title}</strong>
            <span>{readiness.detail}</span>
          </span>
        </div>

        {readiness.actionItems.length > 0 && (
          <div className="hud-actions" aria-label="Recording checks that need attention">
            {readiness.actionItems.slice(0, 3).map((item) => (
              <div className="hud-action" key={item.id} data-state={item.state}>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
            ))}
            {readiness.actionItems.length > 3 && (
              <div className="tiny muted">
                And {readiness.actionItems.length - 3} more in details
              </div>
            )}
          </div>
        )}

        <div className="hud-preflight-tools">
          <span className="label">Support details</span>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={copySupportSummary}>
            Copy summary
          </button>
        </div>
        <details className="hud-preflight">
          <summary>
            <span>Technical checks</span>
            <span className="spacer" />
            <span>{preflight?.items.length ?? 0}</span>
          </summary>
          <div className="hud-checks">
            {preflight?.items.map((item) => (
              <div className="hud-check" key={item.id} data-state={item.state}>
                <span className="hud-check-dot" aria-hidden="true" />
                <span>{item.label}</span>
                <span className="hud-state-label">{capabilityStateLabel(item.state)}</span>
                <span className="tiny muted">{item.detail}</span>
              </div>
            ))}
          </div>
        </details>
        {error && <div className="hud-error">{error}</div>}
      </div>

      <footer>
        <button className="btn ghost" onClick={() => api.hud.close()}>
          Cancel
        </button>
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={preflightBusy || !preflight?.canStart}
          onClick={() => void beginRecording()}
        >
          <Icon name="record" size={12} /> Start recording
        </button>
      </footer>
    </div>
  )
}
