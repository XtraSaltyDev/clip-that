import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DisplayInfo, RecordingOptions, VideoExportOptions, WindowInfo } from '@shared/types'
import { DEFAULT_RECORDING } from '@shared/defaults'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import { Segmented, Slider, Toggle, formatDuration, useTheme } from '../shared/ui'
import { listDevices, posterFromBlob, startCapture, type CaptureHandles } from './pipeline'
import './hud.css'

type Phase = 'setup' | 'countdown' | 'recording' | 'review' | 'encoding'

const SIZES: Record<Phase, [number, number]> = {
  setup: [440, 620],
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
    ffmpeg: boolean
  } | null>(null)
  const [devices, setDevices] = useState<{ microphones: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] }>({
    microphones: [],
    cameras: []
  })
  const [count, setCount] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  const [blob, setBlob] = useState<Blob | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [trim, setTrim] = useState<[number, number]>([0, 0])
  const [format, setFormat] = useState<VideoExportOptions['format']>('mp4')
  const [quality, setQuality] = useState<VideoExportOptions['quality']>('high')

  const capture = useRef<CaptureHandles | null>(null)
  const startedAt = useRef(0)
  const pausedFor = useRef(0)
  const pausedAt = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)

  /* ---------- window sizing follows the phase ---------- */

  useEffect(() => {
    const [w, h] = SIZES[phase]
    if (phase === 'recording' || phase === 'countdown') api.hud.dock(w, h)
    else api.hud.resize(w, h)
  }, [phase])

  /* ---------- data ---------- */

  useEffect(() => {
    void api.recording.sources().then((s) => {
      setSources(s)
      setOptions((o) => ({
        ...o,
        displayId: o.displayId ?? s.displays.find((d) => d.primary)?.id ?? s.displays[0]?.id
      }))
    })
    void api.settings.get().then((r) => setOptions((o) => ({ ...r.settings.recording, ...o })))
    void listDevices().then(setDevices)
  }, [])

  useEffect(() => api.recording.onProgress(({ percent }) => setProgress(percent)), [])

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
    setError(null)
    await api.recording.configure(options)

    if (options.countdown > 0) {
      setPhase('countdown')
      setCount(options.countdown)
      for (let i = options.countdown; i > 0; i--) {
        setCount(i)
        await new Promise((r) => setTimeout(r, 1000))
      }
    }

    try {
      await api.recording.start(options)
      const handles = await startCapture(options, options.region)
      capture.current = handles
      startedAt.current = Date.now()
      pausedFor.current = 0
      setElapsed(0)
      setPaused(false)
      setPhase('recording')
      api.recording.started()
    } catch (err) {
      setError((err as Error).message || 'Screen capture was refused')
      setPhase('setup')
      await api.recording.cancel()
    }
  }, [options])

  const finishRecording = useCallback(async () => {
    const handles = capture.current
    if (!handles) return
    capture.current = null
    const recorded = await handles.stop()
    setBlob(recorded)
    const url = URL.createObjectURL(recorded)
    setBlobUrl(url)
    setPhase('review')
  }, [])

  const cancelRecording = useCallback(async () => {
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
      pausedAt.current = Date.now()
      setPaused(true)
      void api.recording.pause()
    } else if (recorder.state === 'paused') {
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
    if (!blobUrl || !videoRef.current) return
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
  }, [blobUrl])

  const saveRecording = useCallback(async () => {
    if (!blob) return
    setPhase('encoding')
    setProgress(0)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await api.recording.saveBlob(bytes)
    const poster = await posterFromBlob(blob, trim[0] + 200)
    const item = await api.recording.export(
      {
        format,
        quality,
        startMs: trim[0],
        endMs: trim[1],
        fps: format === 'gif' ? 15 : undefined,
        maxWidth: format === 'gif' ? 900 : undefined
      },
      {
        width: capture.current?.width ?? videoRef.current?.videoWidth ?? 1920,
        height: capture.current?.height ?? videoRef.current?.videoHeight ?? 1080,
        durationMs: duration,
        posterDataUrl: poster
      }
    )
    if (item) api.hud.close()
    else {
      setError('Encoding failed — check that ffmpeg is available.')
      setPhase('review')
    }
  }, [blob, duration, format, quality, trim])

  const discard = useCallback(() => {
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    api.hud.close()
  }, [blobUrl])

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
        <span className="hud-time mono">{formatDuration(elapsed)}</span>
        <span className="spacer" />
        <button className="hud-btn no-drag" onClick={togglePause} title={paused ? 'Resume' : 'Pause'}>
          <Icon name={paused ? 'play' : 'pause'} size={15} />
        </button>
        <button
          className="hud-btn stop no-drag"
          onClick={() => void finishRecording()}
          title="Stop and review"
        >
          <Icon name="stop" size={15} />
        </button>
        <button className="hud-btn no-drag" onClick={() => void cancelRecording()} title="Discard">
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
      </div>
    )
  }

  if (phase === 'review') {
    return (
      <div className="hud-card hud-review">
        <header className="drag-region">
          <Icon name="video" size={16} />
          <h1>Review recording</h1>
          <span className="spacer" />
          <button className="btn ghost icon no-drag" onClick={discard}>
            <Icon name="close" />
          </button>
        </header>

        <div className="hud-video">
          {blobUrl && <video ref={videoRef} src={blobUrl} controls preload="metadata" />}
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
              { value: 'mp4', label: 'MP4' },
              { value: 'gif', label: 'GIF' },
              { value: 'webm', label: 'WebM' }
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

        <footer>
          <button className="btn ghost" onClick={discard}>
            Discard
          </button>
          <span className="spacer" />
          <button className="btn primary" onClick={() => void saveRecording()}>
            <Icon name="download" size={14} /> Save {format.toUpperCase()}
          </button>
        </footer>
      </div>
    )
  }

  /* ---------- setup ---------- */

  const set = (patch: Partial<RecordingOptions>) => setOptions((o) => ({ ...o, ...patch }))

  return (
    <div className="hud-card hud-setup">
      <header className="drag-region">
        <Icon name="video" size={16} />
        <h1>Record screen</h1>
        <span className="spacer" />
        <button className="btn ghost icon no-drag" onClick={() => api.hud.close()}>
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
              { value: 'window', label: 'Window' }
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
          hint={devices.microphones[0]?.label || 'Record narration'}
          checked={options.microphone}
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

        <Toggle
          label="System audio"
          hint={
            sources?.systemAudioSupported
              ? 'Capture what the computer plays'
              : 'Not available on macOS without a virtual audio device'
          }
          disabled={!sources?.systemAudioSupported}
          checked={options.systemAudio && Boolean(sources?.systemAudioSupported)}
          onChange={(systemAudio) => set({ systemAudio })}
        />

        <Toggle
          label="Webcam bubble"
          hint={devices.cameras[0]?.label || 'Overlay your camera in a corner'}
          checked={options.webcam}
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
                  { value: 'tl', label: '◤' },
                  { value: 'tr', label: '◥' },
                  { value: 'bl', label: '◣' },
                  { value: 'br', label: '◢' }
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

        <div className="divider" />

        <Slider
          label="Countdown"
          value={options.countdown}
          min={0}
          max={10}
          suffix="s"
          onChange={(countdown) => set({ countdown })}
        />

        {sources && !sources.ffmpeg && (
          <div className="hud-error">
            <Icon name="alert" size={14} /> ffmpeg wasn't found, so MP4 and GIF export is
            unavailable. WebM still works.
          </div>
        )}
        {error && <div className="hud-error">{error}</div>}
      </div>

      <footer>
        <button className="btn ghost" onClick={() => api.hud.close()}>
          Cancel
        </button>
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={options.target === 'window' && !options.windowId}
          onClick={() => void beginRecording()}
        >
          <Icon name="record" size={12} /> Start recording
        </button>
      </footer>
    </div>
  )
}
