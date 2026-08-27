import React, { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LibraryItem,
  RecordingMediaCapabilities,
  VideoAspectPreset,
  VideoExportPreset
} from '@shared/types'
import {
  VIDEO_EXPORT_PRESETS,
  aspectCanvasDimensions,
  aspectLabel,
  aspectRatio,
  exportPresetAvailability,
  recordingPolishCapabilities,
  transcriptStatus,
  videoExportPreset
} from '@shared/recording-polish'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import { Segmented, ToastHost, formatBytes, formatDuration, toast } from '../shared/ui'
import LibraryStrip from './panels/LibraryStrip'

const FILMSTRIP_FRAMES = 10
const MIN_TRIM_MS = 200

function timecode(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100))
  const hours = Math.floor(tenths / 36_000)
  const minutes = Math.floor((tenths % 36_000) / 600)
  const seconds = Math.floor((tenths % 600) / 10)
  const decimal = tenths % 10
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${decimal}`
}

function parseTimecode(value: string): number | null {
  const parts = value.trim().split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => part.trim() === '')) return null
  const seconds = Number(parts.at(-1))
  const minutes = Number(parts.at(-2))
  const hours = parts.length === 3 ? Number(parts[0]) : 0
  if (
    ![seconds, minutes, hours].every(Number.isFinite) ||
    seconds < 0 ||
    seconds >= 60 ||
    minutes < 0 ||
    minutes >= 60 ||
    hours < 0
  )
    return null
  return (hours * 3600 + minutes * 60 + seconds) * 1000
}

function itemTrim(item: LibraryItem, duration: number): [number, number] {
  const end = Math.max(0, duration || item.durationMs || 0)
  const draft = item.videoEdit
  if (!draft || end <= 0) return [0, end]
  const startMs = Math.max(0, Math.min(draft.startMs, end - MIN_TRIM_MS))
  const endMs = Math.min(end, Math.max(draft.endMs, startMs + MIN_TRIM_MS))
  return [startMs, endMs]
}

function waitForVideo(video: HTMLVideoElement, event: 'loadeddata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Video ${event} timed out`))
    }, 5000)
    const done = () => {
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(new Error('Video could not be decoded'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener(event, done)
      video.removeEventListener('error', failed)
    }
    video.addEventListener(event, done, { once: true })
    video.addEventListener('error', failed, { once: true })
  })
}

async function buildFilmstrip(
  url: string,
  durationMs: number,
  cancelled: () => boolean
): Promise<string[]> {
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.preload = 'auto'
  video.src = url
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitForVideo(video, 'loadeddata')

  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 90
  const ctx = canvas.getContext('2d')
  if (!ctx || video.videoWidth <= 0 || video.videoHeight <= 0) return []

  const frames: string[] = []
  try {
    for (let index = 0; index < FILMSTRIP_FRAMES; index += 1) {
      if (cancelled()) return []
      const target = Math.min(
        Math.max(0, durationMs / 1000 - 0.05),
        (durationMs / 1000) * (index / Math.max(1, FILMSTRIP_FRAMES - 1))
      )
      if (Math.abs(video.currentTime - target) > 0.02) {
        const ready = waitForVideo(video, 'seeked')
        video.currentTime = target
        await ready
      }

      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
      const width = video.videoWidth * scale
      const height = video.videoHeight * scale
      ctx.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
      frames.push(canvas.toDataURL('image/jpeg', 0.65))
    }
    return frames
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}

async function posterFromVideo(
  video: HTMLVideoElement,
  aspect: VideoAspectPreset,
  maxWidth?: number
): Promise<string | undefined> {
  try {
    if (video.videoWidth <= 0 || video.videoHeight <= 0) return undefined
    const canvasSize = aspectCanvasDimensions(aspect, maxWidth ?? 1280) ?? {
      width: video.videoWidth,
      height: video.videoHeight
    }
    const canvas = document.createElement('canvas')
    canvas.width = canvasSize.width
    canvas.height = canvasSize.height
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.fillStyle = '#000'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
    const width = video.videoWidth * scale
    const height = video.videoHeight * scale
    context.drawImage(
      video,
      (canvas.width - width) / 2,
      (canvas.height - height) / 2,
      width,
      height
    )
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}

export default function VideoEditor(props: {
  item: LibraryItem
  openingId: string | null
  onItemChanged: (item: LibraryItem) => void
  onOpen: (item: LibraryItem) => void
  registerDraftFlush: (flush: (() => Promise<void>) | null) => void
}): React.ReactElement {
  const { item } = props
  const videoRef = useRef<HTMLVideoElement>(null)
  const trimRailRef = useRef<HTMLDivElement>(null)
  const draftReady = useRef(false)
  const [title, setTitle] = useState(item.title)
  const [duration, setDuration] = useState(item.durationMs ?? 0)
  const [trim, setTrim] = useState<[number, number]>([0, item.durationMs ?? 0])
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4')
  const [quality, setQuality] = useState<'medium' | 'high'>('high')
  const [aspect, setAspect] = useState<VideoAspectPreset>('original')
  const [exportPreset, setExportPreset] = useState<VideoExportPreset>('custom')
  const [mediaCapabilities, setMediaCapabilities] = useState<RecordingMediaCapabilities | null>(
    null
  )
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [filmstrip, setFilmstrip] = useState<string[]>([])
  const [playingSelection, setPlayingSelection] = useState(false)
  const [loopSelection, setLoopSelection] = useState(false)
  const mediaUrl = api.library.fileUrl(item.filePath)

  useEffect(() => {
    draftReady.current = false
    setTitle(item.title)
    const itemDuration = item.durationMs ?? 0
    setDuration(itemDuration)
    setTrim(itemTrim(item, itemDuration))
    setFormat(item.videoEdit?.format ?? 'mp4')
    setQuality(item.videoEdit?.quality ?? 'high')
    setAspect(item.videoEdit?.aspect ?? 'original')
    setExportPreset(item.videoEdit?.exportPreset ?? 'custom')
    setSaving(false)
    setProgress(0)
    setPlayhead(0)
    setFilmstrip([])
    setPlayingSelection(false)
    draftReady.current = true
  }, [item.id, item.durationMs, item.title])

  useEffect(() => {
    let active = true
    void api.recording
      .mediaCapabilities()
      .then((capabilities) => {
        if (active) setMediaCapabilities(capabilities)
      })
      .catch(() => {
        if (active) setMediaCapabilities(null)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => api.recording.onProgress(({ percent }) => setProgress(percent)), [])

  const durationKey = Math.round(duration / 1000)
  useEffect(() => {
    if (duration <= 0) return
    let stopped = false
    void buildFilmstrip(mediaUrl, duration, () => stopped)
      .then((frames) => {
        if (!stopped) setFilmstrip(frames)
      })
      .catch(() => {
        if (!stopped) setFilmstrip([])
      })
    return () => {
      stopped = true
    }
    // A sub-second metadata correction should not regenerate every thumbnail.
  }, [item.id, durationKey])

  const update = useCallback(
    async (patch: Parameters<typeof api.library.update>[1]) => {
      const next = await api.library.update(item.id, patch)
      if (next) props.onItemChanged(next)
    },
    [item.id, props.onItemChanged]
  )

  const persistDraft = useCallback(async () => {
    if (!draftReady.current || duration <= 0 || trim[1] <= trim[0]) return
    await update({
      videoEdit: {
        startMs: trim[0],
        endMs: trim[1],
        format,
        quality,
        aspect,
        exportPreset,
        updatedAt: Date.now()
      }
    })
  }, [aspect, duration, exportPreset, format, quality, trim, update])

  useEffect(() => {
    props.registerDraftFlush(persistDraft)
    return () => props.registerDraftFlush(null)
  }, [persistDraft, props.registerDraftFlush])

  useEffect(() => {
    if (!draftReady.current || duration <= 0 || trim[1] <= trim[0]) return
    const timer = setTimeout(() => {
      void persistDraft().catch((error) =>
        toast('error', 'Video edit draft could not be saved', (error as Error).message)
      )
    }, 500)
    return () => clearTimeout(timer)
  }, [duration, persistDraft, trim])

  const saveCopy = useCallback(async () => {
    const video = videoRef.current
    if (!video || saving || trim[1] <= trim[0]) return
    setSaving(true)
    setProgress(0)
    try {
      const result = await api.library.exportVideo(
        item.id,
        {
          format,
          quality,
          startMs: trim[0],
          endMs: trim[1],
          fps: videoExportPreset(exportPreset)?.fps ?? 30,
          maxWidth: videoExportPreset(exportPreset)?.maxWidth,
          aspect,
          exportPreset
        },
        await posterFromVideo(video, aspect, selectedPreset?.maxWidth)
      )
      toast('success', 'Edited copy saved', result.title)
    } catch (error) {
      if (/cancelled/i.test((error as Error).message)) toast('info', 'Video export cancelled')
      else toast('error', 'Could not save the edited copy', (error as Error).message)
    } finally {
      setSaving(false)
    }
  }, [aspect, exportPreset, format, item.id, quality, saving, trim])

  const cancelSave = useCallback(async () => {
    if (await api.library.cancelVideoExport()) toast('info', 'Cancelling video export…')
  }, [])

  const seek = (ms: number) => {
    const bounded = Math.max(0, Math.min(duration, ms))
    setPlayhead(bounded)
    if (videoRef.current) videoRef.current.currentTime = bounded / 1000
  }

  const playSelection = useCallback(() => {
    const video = videoRef.current
    if (!video || trim[1] <= trim[0]) return
    seek(trim[0])
    setPlayingSelection(true)
    void video.play()
  }, [trim])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, select, textarea, button, [contenteditable="true"]')) return
      const video = videoRef.current
      if (!video) return
      if (event.key === ' ' || event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (video.paused) void video.play()
        else video.pause()
      } else if (event.key.toLowerCase() === 'j' || event.key === 'ArrowLeft') {
        event.preventDefault()
        seek(playhead - (event.shiftKey ? 1000 : 100))
      } else if (event.key.toLowerCase() === 'l' || event.key === 'ArrowRight') {
        event.preventDefault()
        seek(playhead + (event.shiftKey ? 1000 : 100))
      } else if (event.key === ',' || event.key === '.') {
        event.preventDefault()
        seek(playhead + (event.key === ',' ? -1000 / 30 : 1000 / 30))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [duration, playhead])

  const updateTrimPoint = (edge: 'start' | 'end', rawValue: number) => {
    const value =
      edge === 'start'
        ? Math.max(0, Math.min(rawValue, trim[1] - MIN_TRIM_MS))
        : Math.min(duration, Math.max(rawValue, trim[0] + MIN_TRIM_MS))
    setTrim(edge === 'start' ? [value, trim[1]] : [trim[0], value])
    seek(value)
  }

  const pointerTrimValue = (clientX: number): number => {
    const rail = trimRailRef.current
    if (!rail || duration <= 0) return 0
    const bounds = rail.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width))
    return ratio * duration
  }

  const beginTrimDrag = (edge: 'start' | 'end', event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    updateTrimPoint(edge, pointerTrimValue(event.clientX))
  }

  const moveTrimDrag = (edge: 'start' | 'end', event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    updateTrimPoint(edge, pointerTrimValue(event.clientX))
  }

  const keyTrimPoint = (edge: 'start' | 'end', event: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = edge === 'start' ? trim[0] : trim[1]
    const delta = event.shiftKey ? 1_000 : 100
    let next: number | undefined
    if (event.key === 'ArrowLeft') next = current - delta
    else if (event.key === 'ArrowRight') next = current + delta
    else if (event.key === 'Home') next = edge === 'start' ? 0 : trim[0] + MIN_TRIM_MS
    else if (event.key === 'End') next = edge === 'start' ? trim[1] - MIN_TRIM_MS : duration
    if (next === undefined) return
    event.preventDefault()
    updateTrimPoint(edge, next)
  }

  const selectedMs = Math.max(0, trim[1] - trim[0])
  const startPercent = duration > 0 ? (trim[0] / duration) * 100 : 0
  const endPercent = duration > 0 ? (trim[1] / duration) * 100 : 100
  const playheadPercent = duration > 0 ? (playhead / duration) * 100 : 0
  const fullSelection = trim[0] <= 0 && Math.abs(trim[1] - duration) < 1
  const selectedPreset = videoExportPreset(exportPreset)
  const presetDetail =
    selectedPreset?.detail ??
    'Choose a supported recipe, or use the format and quality controls below.'
  const polish = recordingPolishCapabilities({
    hasZoomTimeline: false,
    hasCursorMetadata: false,
    hasClickMetadata: false
  })
  const transcript = transcriptStatus('unavailable')
  const previewRatio = aspectRatio(aspect)

  const applyPreset = (next: VideoExportPreset) => {
    if (!exportPresetAvailability(next, mediaCapabilities).available) return
    setExportPreset(next)
    const preset = videoExportPreset(next)
    if (preset) {
      setFormat(preset.format)
      setQuality(preset.quality)
      setAspect(preset.aspect)
    }
  }

  return (
    <div className="editor-shell">
      <header className="topbar video-topbar drag-region">
        <div className="topbar-left no-drag">
          <Icon name="video" size={16} />
          <span className="muted tiny">Video editor</span>
        </div>
        <div className="topbar-title no-drag">
          <input
            className="title-input"
            value={title}
            aria-label="Recording title"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void update({ title })}
            onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
          />
        </div>
        <div className="topbar-right no-drag">
          <button className="btn" onClick={() => void api.exports.reveal(item.filePath)}>
            <Icon name="folder" size={14} /> Reveal
          </button>
          {saving && (
            <button className="btn ghost" onClick={() => void cancelSave()}>
              <Icon name="close" size={14} /> Cancel export
            </button>
          )}
          <button className="btn primary" disabled={saving} onClick={() => void saveCopy()}>
            <Icon name="save" size={14} />{' '}
            {saving ? `Saving ${Math.round(progress)}%` : 'Save copy'}
          </button>
        </div>
      </header>

      <div className="editor-body video-editor-body">
        <main className="video-workspace">
          <div
            className="video-preview-frame"
            style={previewRatio ? { aspectRatio: String(previewRatio) } : undefined}
            aria-label={`${aspectLabel(aspect)} recording preview`}
          >
            <video
              ref={videoRef}
              src={mediaUrl}
              crossOrigin="anonymous"
              controls
              preload="metadata"
              onTimeUpdate={(event) => {
                const next = event.currentTarget.currentTime * 1000
                setPlayhead(next)
                if (playingSelection && next >= trim[1] - 20) {
                  if (loopSelection) {
                    event.currentTarget.currentTime = trim[0] / 1000
                    void event.currentTarget.play()
                  } else {
                    event.currentTarget.pause()
                    setPlayingSelection(false)
                    setPlayhead(trim[1])
                  }
                }
              }}
              onPause={() => {
                if (playingSelection && !loopSelection) setPlayingSelection(false)
              }}
              onLoadedMetadata={(event) => {
                const ms = Number.isFinite(event.currentTarget.duration)
                  ? event.currentTarget.duration * 1000
                  : (item.durationMs ?? 0)
                if (ms > 0) {
                  setDuration(ms)
                  setTrim(itemTrim(item, ms))
                }
              }}
              onError={() => toast('error', 'This recording could not be played inside ClipThat')}
            />
          </div>
          <section className="video-trimmer" aria-label="Trim recording">
            <div className="video-trim-heading">
              <div>
                <Icon name="scissors" size={14} />
                <strong>Trim</strong>
                <span className="tiny muted">Keep {timecode(selectedMs)}</span>
              </div>
              <div className="video-trim-actions">
                <button className="btn ghost sm" onClick={playSelection}>
                  <Icon name="play" size={12} /> Play selection
                </button>
                <button
                  className="btn ghost sm"
                  aria-pressed={loopSelection}
                  onClick={() => setLoopSelection((value) => !value)}
                >
                  <Icon name="refresh" size={12} /> {loopSelection ? 'Looping' : 'Loop'}
                </button>
                <button
                  className="btn ghost sm"
                  disabled={fullSelection}
                  onClick={() => {
                    setTrim([0, duration])
                    seek(0)
                  }}
                >
                  Reset trim
                </button>
              </div>
            </div>

            <div className="video-trim-rail" ref={trimRailRef}>
              <div className="video-filmstrip" aria-hidden="true">
                {(filmstrip.length ? filmstrip : Array.from({ length: FILMSTRIP_FRAMES })).map(
                  (frame, index) =>
                    typeof frame === 'string' ? (
                      <img key={index} src={frame} alt="" />
                    ) : (
                      <span key={index} />
                    )
                )}
              </div>
              <div
                className="video-trim-muted video-trim-muted-start"
                style={{ width: `${startPercent}%` }}
              />
              <div
                className="video-trim-muted video-trim-muted-end"
                style={{ width: `${100 - endPercent}%` }}
              />
              <div
                className="video-trim-selection"
                style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
              />
              <div
                className="video-trim-playhead"
                style={{ left: `${playheadPercent}%` }}
                aria-hidden="true"
              />
              <button
                type="button"
                className="video-trim-handle start"
                style={{ left: `${startPercent}%` }}
                role="slider"
                aria-label="Trim start"
                aria-valuemin={0}
                aria-valuemax={Math.max(0, trim[1] - MIN_TRIM_MS)}
                aria-valuenow={Math.round(trim[0])}
                aria-valuetext={timecode(trim[0])}
                onPointerDown={(event) => beginTrimDrag('start', event)}
                onPointerMove={(event) => moveTrimDrag('start', event)}
                onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
                onKeyDown={(event) => keyTrimPoint('start', event)}
              />
              <button
                type="button"
                className="video-trim-handle end"
                style={{ left: `${endPercent}%` }}
                role="slider"
                aria-label="Trim end"
                aria-valuemin={Math.min(duration, trim[0] + MIN_TRIM_MS)}
                aria-valuemax={duration}
                aria-valuenow={Math.round(trim[1])}
                aria-valuetext={timecode(trim[1])}
                onPointerDown={(event) => beginTrimDrag('end', event)}
                onPointerMove={(event) => moveTrimDrag('end', event)}
                onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
                onKeyDown={(event) => keyTrimPoint('end', event)}
              />
            </div>
            <div className="video-trim-ticks mono tiny muted" aria-hidden="true">
              <span>00:00</span>
              <span>{formatDuration(duration / 2)}</span>
              <span>{formatDuration(duration)}</span>
            </div>

            <div className="video-trim-values">
              <div className="video-trim-value">
                <span className="tiny muted">Start</span>
                <input
                  key={`start-${Math.round(trim[0])}`}
                  className="video-timecode mono"
                  aria-label="Trim start timecode"
                  defaultValue={timecode(trim[0])}
                  onBlur={(event) => {
                    const value = parseTimecode(event.currentTarget.value)
                    if (value === null) event.currentTarget.value = timecode(trim[0])
                    else updateTrimPoint('start', value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') {
                      event.currentTarget.value = timecode(trim[0])
                      event.currentTarget.blur()
                    }
                  }}
                />
                <button
                  className="btn ghost sm"
                  disabled={playhead >= trim[1] - MIN_TRIM_MS}
                  onClick={() => setTrim([Math.max(0, playhead), trim[1]])}
                >
                  Use playhead
                </button>
              </div>
              <div className="video-trim-value selection">
                <span className="tiny muted">Selection</span>
                <output className="mono">{timecode(selectedMs)}</output>
                <span className="tiny muted">of {timecode(duration)}</span>
              </div>
              <div className="video-trim-value end">
                <span className="tiny muted">End</span>
                <input
                  key={`end-${Math.round(trim[1])}`}
                  className="video-timecode mono"
                  aria-label="Trim end timecode"
                  defaultValue={timecode(trim[1])}
                  onBlur={(event) => {
                    const value = parseTimecode(event.currentTarget.value)
                    if (value === null) event.currentTarget.value = timecode(trim[1])
                    else updateTrimPoint('end', value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') {
                      event.currentTarget.value = timecode(trim[1])
                      event.currentTarget.blur()
                    }
                  }}
                />
                <button
                  className="btn ghost sm"
                  disabled={playhead <= trim[0] + MIN_TRIM_MS}
                  onClick={() => setTrim([trim[0], Math.min(duration, playhead)])}
                >
                  Use playhead
                </button>
              </div>
            </div>
          </section>
        </main>

        <aside className="video-inspector">
          <h2>Recording</h2>
          <dl className="video-facts tiny">
            <div>
              <dt>Size</dt>
              <dd>
                {item.width} × {item.height}
              </dd>
            </div>
            <div>
              <dt>Length</dt>
              <dd>{formatDuration(duration)}</dd>
            </div>
            <div>
              <dt>File</dt>
              <dd>{formatBytes(item.byteSize)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{new Date(item.createdAt).toLocaleString()}</dd>
            </div>
          </dl>
          <div className="divider" />
          <label className="tiny muted">Export preset</label>
          <Segmented
            value={exportPreset}
            options={[
              {
                value: 'custom',
                label: 'Custom',
                tip: 'Keep the format and quality controls below.'
              },
              ...VIDEO_EXPORT_PRESETS.map((preset) => {
                const availability = exportPresetAvailability(preset.id, mediaCapabilities)
                return {
                  value: preset.id,
                  label:
                    preset.id === 'web'
                      ? 'Web'
                      : preset.id === 'presentation'
                        ? 'Slides'
                        : 'Vertical',
                  disabled: !availability.available,
                  tip: availability.available ? preset.detail : availability.reason
                }
              })
            ]}
            onChange={applyPreset}
          />
          <p className="tiny muted video-control-note">{presetDetail}</p>
          <label className="tiny muted">Canvas framing</label>
          <Segmented
            value={aspect}
            options={[
              { value: 'original', label: 'Original' },
              { value: 'landscape', label: '16:9' },
              { value: 'square', label: '1:1' },
              { value: 'vertical', label: '9:16' }
            ]}
            onChange={setAspect}
          />
          <p className="tiny muted video-control-note">
            Preview uses letterboxing; the source recording is unchanged.
          </p>
          <label className="tiny muted">Format</label>
          <Segmented
            value={format}
            options={[
              { value: 'mp4', label: 'MP4' },
              { value: 'webm', label: 'WebM' }
            ]}
            onChange={(value) => {
              setFormat(value)
              setExportPreset('custom')
            }}
          />
          <label className="tiny muted">Quality</label>
          <Segmented
            value={quality}
            options={[
              { value: 'medium', label: 'Balanced' },
              { value: 'high', label: 'High' }
            ]}
            onChange={(value) => {
              setQuality(value)
              setExportPreset('custom')
            }}
          />
          <div className="divider" />
          <section className="video-capability-section" aria-labelledby="recording-polish-heading">
            <h3 id="recording-polish-heading">Recording polish</h3>
            <div className="video-capability unavailable">
              <strong>Zooms unavailable</strong>
              <span>{polish.zooms.detail}</span>
            </div>
            <div className="video-capability unavailable">
              <strong>Cursor &amp; clicks unavailable</strong>
              <span>
                {polish.cursor.detail} {polish.clicks.detail}
              </span>
            </div>
            <div className="video-capability unavailable">
              <strong>{transcript.label}</strong>
              <span>{transcript.detail}</span>
            </div>
          </section>
          <div className="divider" />
          <button className="btn" onClick={() => void update({ favorite: !item.favorite })}>
            <Icon name="star" size={14} /> {item.favorite ? 'Remove favourite' : 'Add favourite'}
          </button>
          <p className="tiny muted video-save-note">
            Save copy is non-destructive. The original recording stays in your Library.
          </p>
        </aside>

        <LibraryStrip
          activeId={item.id}
          openingId={props.openingId}
          onOpen={(next) => {
            if (saving) toast('info', 'Finish or cancel the video export before switching items')
            else void persistDraft().then(() => props.onOpen(next))
          }}
        />
      </div>
      <ToastHost />
    </div>
  )
}
