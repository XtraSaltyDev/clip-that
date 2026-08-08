import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryItem, VideoExportOptions } from '@shared/types'
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

async function posterFromVideo(video: HTMLVideoElement): Promise<string | undefined> {
  try {
    if (video.videoWidth <= 0 || video.videoHeight <= 0) return undefined
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
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
}): React.ReactElement {
  const { item } = props
  const videoRef = useRef<HTMLVideoElement>(null)
  const trimRailRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState(item.title)
  const [duration, setDuration] = useState(item.durationMs ?? 0)
  const [trim, setTrim] = useState<[number, number]>([0, item.durationMs ?? 0])
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4')
  const [quality, setQuality] = useState<VideoExportOptions['quality']>('high')
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [filmstrip, setFilmstrip] = useState<string[]>([])
  const mediaUrl = api.library.fileUrl(item.filePath)

  useEffect(() => {
    setTitle(item.title)
    setDuration(item.durationMs ?? 0)
    setTrim([0, item.durationMs ?? 0])
    setSaving(false)
    setProgress(0)
    setPlayhead(0)
    setFilmstrip([])
  }, [item.id, item.durationMs, item.title])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, durationKey])

  const update = useCallback(
    async (patch: Parameters<typeof api.library.update>[1]) => {
      const next = await api.library.update(item.id, patch)
      if (next) props.onItemChanged(next)
    },
    [item.id, props.onItemChanged]
  )

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
          fps: 30
        },
        await posterFromVideo(video)
      )
      toast('success', 'Edited copy saved', result.title)
    } catch (error) {
      toast('error', 'Could not save the edited copy', (error as Error).message)
    } finally {
      setSaving(false)
    }
  }, [format, item.id, quality, saving, trim])

  const seek = (ms: number) => {
    setPlayhead(ms)
    if (videoRef.current) videoRef.current.currentTime = ms / 1000
  }

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

  const beginTrimDrag = (
    edge: 'start' | 'end',
    event: React.PointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    updateTrimPoint(edge, pointerTrimValue(event.clientX))
  }

  const moveTrimDrag = (
    edge: 'start' | 'end',
    event: React.PointerEvent<HTMLButtonElement>
  ) => {
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
          <button className="btn primary" disabled={saving} onClick={() => void saveCopy()}>
            <Icon name="save" size={14} /> {saving ? `Saving ${Math.round(progress)}%` : 'Save copy'}
          </button>
        </div>
      </header>

      <div className="editor-body video-editor-body">
        <main className="video-workspace">
          <video
            ref={videoRef}
            src={mediaUrl}
            crossOrigin="anonymous"
            controls
            preload="metadata"
            onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime * 1000)}
            onLoadedMetadata={(event) => {
              const ms = Number.isFinite(event.currentTarget.duration)
                ? event.currentTarget.duration * 1000
                : item.durationMs ?? 0
              if (ms > 0) {
                setDuration(ms)
                setTrim([0, ms])
              }
            }}
            onError={() => toast('error', 'This recording could not be played inside ClipThat')}
          />
          <section className="video-trimmer" aria-label="Trim recording">
            <div className="video-trim-heading">
              <div>
                <Icon name="scissors" size={14} />
                <strong>Trim</strong>
                <span className="tiny muted">Keep {timecode(selectedMs)}</span>
              </div>
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
                <output className="mono">{timecode(trim[0])}</output>
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
                <output className="mono">{timecode(trim[1])}</output>
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
            <div><dt>Size</dt><dd>{item.width} × {item.height}</dd></div>
            <div><dt>Length</dt><dd>{formatDuration(duration)}</dd></div>
            <div><dt>File</dt><dd>{formatBytes(item.byteSize)}</dd></div>
            <div><dt>Created</dt><dd>{new Date(item.createdAt).toLocaleString()}</dd></div>
          </dl>
          <div className="divider" />
          <label className="tiny muted">Format</label>
          <Segmented
            value={format}
            options={[{ value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' }]}
            onChange={setFormat}
          />
          <label className="tiny muted">Quality</label>
          <Segmented
            value={quality}
            options={[
              { value: 'medium', label: 'Balanced' },
              { value: 'high', label: 'High' }
            ]}
            onChange={setQuality}
          />
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
          onOpen={props.onOpen}
        />
      </div>
      <ToastHost />
    </div>
  )
}
