import React, { useEffect, useRef, useState } from 'react'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import { IS_MAC_RENDERER, MOD_KEY } from '../shared/platform'
import { useEvent, useSurfaceTheme } from '../shared/ui'
import './hud.css'

interface Payload {
  id: string
  kind: 'image' | 'video'
  thumb: string
  title: string
  width: number
  height: number
  durationMs?: number
}

type Action = 'copy' | 'save' | 'pin' | 'edit' | 'reveal' | 'pipeline' | 'copyFile'

/**
 * The Quick Access card. Everything a capture usually needs, two seconds after the
 * hotkey: drag the thumbnail into another app, or copy / save / pin / edit. Stays until
 * dismissed; a newer capture replaces its contents.
 */
export default function QuickAccess(): React.ReactElement | null {
  useSurfaceTheme()
  const [payload, setPayload] = useState<Payload | null>(null)
  const [done, setDone] = useState<{ message: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const generation = useRef(0)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileManager = IS_MAC_RENDERER ? 'Finder' : 'your file manager'

  useEffect(
    () =>
      api.quick.onInit((p) => {
        generation.current++
        if (closeTimer.current) clearTimeout(closeTimer.current)
        inFlight.current = false
        setBusy(false)
        setPayload(p as Payload)
        setDone(null)
      }),
    []
  )

  useEffect(
    () => () => {
      generation.current++
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    []
  )

  const act = useEvent(async (action: Action) => {
    if (!payload || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setDone(null)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    const current = generation.current
    const closeSoon = (delay: number) => {
      closeTimer.current = setTimeout(() => {
        if (current === generation.current) api.system.window('close')
      }, delay)
    }
    try {
      const res = await api.quick.action(payload.id, action)
      if (current !== generation.current || res.canceled) return
      if (!res.ok) {
        setDone({ message: res.error ?? 'The action could not finish. Try again.', error: true })
        return
      }
      // Keep a short confirmation for actions that return to the source app. Edit and
      // pin open their own surfaces immediately. Copy-file stays open so Finder paste
      // can follow; drag stays open for the OS drag session.
      if (action === 'edit' || action === 'pin') {
        api.system.window('close')
      } else if (action === 'copyFile') {
        setDone({ message: `File copied — paste in ${fileManager}` })
      } else if (action !== 'pipeline') {
        const labels: Partial<Record<Action, string>> = {
          copy: 'Copied',
          save: 'Saved',
          reveal: 'Revealed'
        }
        setDone({ message: labels[action] ?? 'Done' })
        closeSoon(1200)
      } else {
        setDone({ message: 'Pipeline finished' })
        closeSoon(1500)
      }
    } catch (error) {
      if (current === generation.current)
        setDone({ message: (error as Error).message, error: true })
    } finally {
      if (current === generation.current) {
        inFlight.current = false
        setBusy(false)
      }
    }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!payload) return
      if (e.key === 'Escape') {
        e.preventDefault()
        api.system.window('close')
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        void act(payload.kind === 'image' ? 'copy' : 'copyFile')
      } else if (e.key === 'Enter' && e.target === document.body) {
        e.preventDefault()
        void act('edit')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act, payload])

  useEffect(() => {
    if (!payload) return
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('[data-quick-primary]')?.focus()
    )
  }, [payload])

  const drag = () => {
    if (payload) api.quick.drag(payload.id)
  }

  if (!payload) return null

  const image = payload.kind === 'image'
  const unavailable = (action: Action): string | undefined => {
    if (image) return undefined
    if (action === 'copy') return 'Recordings cannot be copied as images'
    if (action === 'save') return 'This recording is already saved in the Library'
    if (action === 'pin') return 'Recordings cannot be pinned as images'
    if (action === 'pipeline') return 'Pipeline actions currently support images only'
    return undefined
  }

  return (
    <div className="qa" role="dialog" aria-label="Capture handoff" aria-busy={busy}>
      <div
        className="qa-thumb"
        data-quick-drag
        title={image ? 'Drag image into another app' : 'Drag recording into another app'}
        draggable
        onDragStart={(e) => {
          e.preventDefault()
          drag()
        }}
      >
        {payload.thumb ? (
          <img src={payload.thumb} alt={`${payload.kind} preview`} draggable={false} />
        ) : (
          <div className="qa-video-placeholder" aria-label="Recording preview unavailable">
            <Icon name="video" size={24} />
            <span>Recording</span>
          </div>
        )}
      </div>

      <div className="qa-body">
        <div className="qa-heading">
          <strong className="qa-title truncate">{payload.title}</strong>
          <span className="qa-meta tiny muted mono">
            {payload.width}×{payload.height}
            {payload.durationMs ? ` · ${Math.round(payload.durationMs / 1000)}s` : ''}
          </span>
        </div>
        <fieldset className="qa-actions" disabled={busy} aria-label="Capture actions">
          <button
            className="qa-btn primary"
            data-quick-primary
            onClick={() => void act('edit')}
            title={`${image ? 'Annotate image' : 'Edit recording'}  ·  ⏎`}
            aria-label={`${image ? 'Annotate image' : 'Edit recording'}  ·  Enter`}
          >
            <Icon name={image ? 'pen' : 'play'} size={14} />
            Edit
          </button>
          <button
            className="qa-btn"
            disabled={Boolean(unavailable('copy'))}
            onClick={() => void act('copy')}
            title={unavailable('copy') ?? `Copy  ·  ${MOD_KEY}C`}
            aria-label={unavailable('copy') ?? `Copy  ·  ${MOD_KEY}C`}
          >
            <Icon name="copy" size={14} />
            Copy
          </button>
          <button
            className="qa-btn"
            disabled={Boolean(unavailable('save'))}
            onClick={() => void act('save')}
            title={unavailable('save') ?? 'Save to your folder'}
            aria-label={unavailable('save') ?? 'Save to your folder'}
          >
            <Icon name="download" size={14} />
            Save
          </button>
          <button
            className="qa-btn"
            disabled={Boolean(unavailable('pin'))}
            onClick={() => void act('pin')}
            title={unavailable('pin') ?? 'Float on screen'}
            aria-label={unavailable('pin') ?? 'Float on screen'}
          >
            <Icon name="lock" size={14} />
            Pin
          </button>
          <button
            className="qa-btn"
            onClick={() => void act('reveal')}
            title={`Reveal in ${fileManager}`}
            aria-label={`Reveal in ${fileManager}`}
          >
            <Icon name="folder" size={14} />
            Reveal
          </button>
          <button
            className="qa-btn"
            data-quick-drag-out
            draggable
            onDragStart={(e) => {
              e.preventDefault()
              drag()
            }}
            onClick={() => void act('copyFile')}
            title={`Drag ${image ? 'image' : 'recording'} out, or click to copy the file and paste in ${fileManager}`}
            aria-label={`Drag ${image ? 'image' : 'recording'} out, or click to copy the file and paste in ${fileManager}`}
          >
            <Icon name="externalLink" size={14} />
            Drag out
          </button>
          <button
            className="qa-btn"
            disabled={Boolean(unavailable('pipeline'))}
            onClick={() => void act('pipeline')}
            title={unavailable('pipeline') ?? 'Run the configured pipeline'}
            aria-label={unavailable('pipeline') ?? 'Run the configured pipeline'}
          >
            <Icon name="layers" size={14} />
            Pipeline
          </button>
        </fieldset>
        {done && (
          <div
            className={`qa-feedback ${done.error ? 'error' : ''}`}
            role={done.error ? 'alert' : 'status'}
          >
            <Icon name={done.error ? 'alert' : 'check'} size={14} />
            <span>{done.message}</span>
          </div>
        )}
        {!done && (
          <div className="qa-hint tiny muted">
            {busy
              ? 'Working…'
              : image
                ? `Drag the preview, or click Drag out and paste in ${fileManager}`
                : `Edit your recording, or click Drag out and paste in ${fileManager}`}
            {' · esc to dismiss'}
          </div>
        )}
      </div>

      <button
        className="qa-close"
        title="Dismiss (Esc)"
        aria-label="Dismiss capture handoff"
        onClick={() => api.system.window('close')}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}
