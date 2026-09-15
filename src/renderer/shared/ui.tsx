import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { Settings, Toast } from '@shared/types'
import { api } from './api'
import { Icon } from './icons'

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

/** Applies the user's theme + accent to the document root, following the OS when set to system. */
export function useTheme(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    let alive = true
    void api.settings.get().then((res) => alive && setSettings(res.settings))
    const off = api.settings.onChanged(setSettings)
    return () => {
      alive = false
      off()
    }
  }, [])

  useAppearance(settings)
  return settings
}

/** Small capture windows only need appearance, not paths, pipelines, or other preferences. */
export function useSurfaceTheme(): void {
  const [appearance, setAppearance] = useState<Pick<Settings, 'theme' | 'accent'> | null>(null)
  useEffect(() => {
    let alive = true
    void api.settings
      .appearance()
      .then((next) => {
        if (alive) setAppearance(next)
      })
      .catch((error) => {
        console.warn('[theme] appearance could not be loaded', (error as Error).message)
      })
    const off = api.settings.onChanged(({ theme, accent }) => setAppearance({ theme, accent }))
    return () => {
      alive = false
      off()
    }
  }, [])
  useAppearance(appearance)
}

function useAppearance(settings: Pick<Settings, 'theme' | 'accent'> | null): void {
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const theme =
        settings.theme === 'system' ? (media.matches ? 'light' : 'dark') : settings.theme
      root.dataset.theme = theme
    }
    apply()
    media.addEventListener('change', apply)
    root.style.setProperty('--accent', settings.accent)
    return () => media.removeEventListener('change', apply)
  }, [settings])
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

let toastSeq = 0

export function ToastHost(): React.ReactElement {
  const [toasts, setToasts] = useState<Array<Toast & { id: number }>>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const dismiss = (id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((current) => current.filter((item) => item.id !== id))
  }

  useEffect(() => {
    const push = (toast: Toast) => {
      const id = ++toastSeq
      setToasts((t) => [...t, { ...toast, id }])
      // Failures stay readable until dismissed; successful actions can fade away.
      if (toast.kind !== 'error')
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), 5000)
        )
    }
    const off = api.system.onToast(push)
    const local = (e: Event) => push((e as CustomEvent<Toast>).detail)
    window.addEventListener('clipthat-toast', local)
    return () => {
      off()
      window.removeEventListener('clipthat-toast', local)
      timers.current.forEach(clearTimeout)
      timers.current.clear()
    }
  }, [])

  return (
    <div className="toast-stack" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="dot" aria-hidden="true" />
          <div className="toast-copy" role={t.kind === 'error' ? 'alert' : 'status'}>
            <div>{t.message}</div>
            {t.detail && <div className="tiny muted toast-detail">{t.detail}</div>}
          </div>
          <button
            className="btn ghost icon"
            aria-label="Dismiss notification"
            onClick={() => dismiss(t.id)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

/** Show a toast in this window only. */
export function toast(kind: Toast['kind'], message: string, detail?: string): void {
  window.dispatchEvent(new CustomEvent('clipthat-toast', { detail: { kind, message, detail } }))
}

/* ------------------------------------------------------------------ *
 * Small controls
 * ------------------------------------------------------------------ */

export function Segmented<T extends string>(props: {
  value: T
  options: Array<{
    value: T
    label: React.ReactNode
    ariaLabel?: string
    tip?: string
    disabled?: boolean
  }>
  onChange: (value: T) => void
}): React.ReactElement {
  const helpId = useId()
  return (
    <div className="segmented">
      {props.options.map((o) => {
        const descriptionId = o.tip ? `${helpId}-${o.value}` : undefined
        return (
          <React.Fragment key={o.value}>
            <button
              aria-pressed={props.value === o.value}
              aria-label={o.ariaLabel}
              aria-describedby={descriptionId}
              data-tip={o.tip}
              className={o.tip ? 'tip' : undefined}
              disabled={o.disabled}
              onClick={() => props.onChange(o.value)}
            >
              {o.label}
            </button>
            {o.tip && (
              <span className="sr-only" id={descriptionId}>
                {o.tip}
              </span>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

export function Slider(props: {
  label?: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
  onChangeStart?: () => void
  onChangeEnd?: () => void
}): React.ReactElement {
  const active = useRef(false)
  const start = () => {
    if (active.current) return
    active.current = true
    props.onChangeStart?.()
  }
  const end = () => {
    if (!active.current) return
    active.current = false
    props.onChangeEnd?.()
  }
  return (
    <label className="col" style={{ gap: 4 }}>
      {props.label && (
        <div className="row">
          <span className="tiny muted">{props.label}</span>
          <span className="spacer" />
          <span className="tiny mono">
            {Math.round(props.value)}
            {props.suffix ?? ''}
          </span>
        </div>
      )}
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onPointerDown={start}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={start}
        onKeyUp={end}
        onBlur={end}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function Toggle(props: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): React.ReactElement {
  return (
    <label className={`row toggle-row ${props.disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span style={{ minWidth: 0 }}>
        <div>{props.label}</div>
        {props.hint && <div className="tiny muted">{props.hint}</div>}
      </span>
    </label>
  )
}

const SWATCHES = [
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#00c7be',
  '#4f8cff',
  '#5856d6',
  '#af52de',
  '#ff2d55',
  '#ffffff',
  '#8e8e93',
  '#000000'
]

export function ColorPicker(props: {
  value: string
  onChange: (value: string) => void
  swatches?: string[]
  allowAlpha?: boolean
  onChangeStart?: () => void
  onChangeEnd?: () => void
}): React.ReactElement {
  const swatches = props.swatches ?? SWATCHES
  const active = useRef(false)
  const start = () => {
    if (active.current) return
    active.current = true
    props.onChangeStart?.()
  }
  const end = () => {
    if (!active.current) return
    active.current = false
    props.onChangeEnd?.()
  }
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 5 }}>
      {swatches.map((c) => (
        <button
          key={c}
          onClick={() => {
            props.onChangeStart?.()
            props.onChange(c)
            props.onChangeEnd?.()
          }}
          title={c}
          aria-label={`Colour ${c}`}
          aria-pressed={props.value.toLowerCase() === c.toLowerCase()}
          style={{
            width: 24,
            height: 24,
            borderRadius: 5,
            background: c,
            border:
              props.value.toLowerCase() === c.toLowerCase()
                ? '2px solid var(--accent)'
                : '1px solid var(--line-strong)',
            boxShadow: 'inset 0 0 0 1px #0003'
          }}
        />
      ))}
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(props.value) ? props.value : '#ff3b30'}
        onFocus={start}
        onBlur={end}
        onChange={(e) => props.onChange(e.target.value)}
        title="Custom colour"
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Hooks
 * ------------------------------------------------------------------ */

/** Global keyboard shortcuts. Handlers are keyed by a normalised combo string. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true): void {
  const ref = useRef(map)
  useLayoutEffect(() => {
    ref.current = map
  })

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      const parts: string[] = []
      if (e.metaKey) parts.push('mod')
      else if (e.ctrlKey) parts.push('mod')
      if (e.shiftKey) parts.push('shift')
      if (e.altKey) parts.push('alt')
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
      parts.push(key)
      const combo = parts.join('+')

      // Let focused controls activate themselves instead of running canvas/Library Enter actions.
      if (
        (key === 'enter' || key === ' ') &&
        target?.closest('button, a, summary, [role="button"]')
      )
        return

      // Single-letter tool shortcuts must not fire while the user is typing.
      if (typing && (!parts.includes('mod') || ['a', 'c', 'v', 'x', 'z', 'y'].includes(key))) return

      const handler = ref.current[combo]
      if (handler) {
        e.preventDefault()
        handler(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

/** Element size, tracked with a ResizeObserver. */
export function useSize<T extends HTMLElement>(): [
  React.RefObject<T>,
  { width: number; height: number }
] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      setSize({ width: box.width, height: box.height })
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

/** Load an HTMLImageElement from a data URL. */
export function useImage(src: string | undefined): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!src) {
      setImage(null)
      return
    }
    let alive = true
    setImage(null)
    const img = new Image()
    img.onload = () => alive && setImage(img)
    img.onerror = () => alive && setImage(null)
    img.src = src
    return () => {
      alive = false
    }
  }, [src])
  return image
}

export function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

/** Stable callback that always sees the latest closure. */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useLatest(fn)
  return useCallback((...args: A) => ref.current(...args), [ref])
}
