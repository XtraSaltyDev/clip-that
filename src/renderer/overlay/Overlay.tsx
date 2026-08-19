import React, { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CaptureEditorVisibility,
  CaptureOverlayUpdate,
  DisplaySnapshot,
  WindowInfo
} from '@shared/types'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import './overlay.css'

type Mode = 'region' | 'window' | 'display' | 'scrolling'

interface Init {
  mode: Mode
  snapshot: DisplaySnapshot
  displayCount: number
  editorVisibility: CaptureEditorVisibility
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type Handle = (typeof HANDLES)[number]
const NO_EDITOR: CaptureEditorVisibility = { available: false, visible: true }

const normalize = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y)
})

const clampBox = (box: Box, w: number, h: number): Box => {
  const x = Math.max(0, Math.min(box.x, w))
  const y = Math.max(0, Math.min(box.y, h))
  return { x, y, w: Math.min(box.w, w - x), h: Math.min(box.h, h - y) }
}

export default function Overlay(): React.ReactElement | null {
  const [init, setInit] = useState<Init | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [dragging, setDragging] = useState(false)
  const [cursor, setCursor] = useState({ x: -999, y: -999 })
  const [hex, setHex] = useState('#000000')
  const [windows, setWindows] = useState<WindowInfo[] | null>(null)
  const [editorVisibility, setEditorVisibility] = useState<CaptureEditorVisibility>(NO_EDITOR)
  const [editorBusy, setEditorBusy] = useState(false)

  const imageRef = useRef<HTMLImageElement | null>(null)
  const pixelsRef = useRef<CanvasRenderingContext2D | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const moveRef = useRef<{
    handle: Handle | 'move'
    origin: Box
    from: { x: number; y: number }
  } | null>(null)
  const loupeRef = useRef<HTMLCanvasElement | null>(null)
  const previewKnownRef = useRef(new Set<string>())
  const previewInFlightRef = useRef(new Set<string>())
  const previewOrderRef = useRef<string[]>([])
  const previewQueueRef = useRef<string[]>([])
  const previewWorkerRef = useRef(false)
  const windowsRequestRef = useRef(0)

  const releaseSnapshot = useCallback(() => {
    const pixels = pixelsRef.current
    if (pixels) {
      // Zeroing the backing store asks Chromium to release the CPU bitmap and GPU texture.
      pixels.canvas.width = 0
      pixels.canvas.height = 0
    }
    pixelsRef.current = null
    if (imageRef.current) imageRef.current.src = ''
    imageRef.current = null
    const loupe = loupeRef.current
    if (loupe) loupe.getContext('2d')?.clearRect(0, 0, loupe.width, loupe.height)
  }, [])

  /* ---------- bootstrap ---------- */

  useEffect(
    () =>
      api.capture.onOverlayInit((payload) => {
        const next = payload as Init
        // Pooled windows are reused across captures; every init starts from scratch.
        releaseSnapshot()
        setBox(null)
        setDragging(false)
        setWindows(null)
        previewKnownRef.current.clear()
        previewInFlightRef.current.clear()
        previewOrderRef.current = []
        previewQueueRef.current = []
        previewWorkerRef.current = false
        setCursor({ x: -999, y: -999 })
        setEditorVisibility(next.editorVisibility ?? NO_EDITOR)
        setEditorBusy(false)
        dragStart.current = null
        moveRef.current = null
        setInit(next)
      }),
    [releaseSnapshot]
  )

  useEffect(
    () =>
      api.capture.onOverlayUpdate((payload: CaptureOverlayUpdate) => {
        setEditorVisibility(payload.editorVisibility)
        if (!payload.snapshot) return
        releaseSnapshot()
        setInit((current) =>
          current
            ? {
                ...current,
                snapshot: payload.snapshot!,
                editorVisibility: payload.editorVisibility
              }
            : current
        )
      }),
    [releaseSnapshot]
  )

  useEffect(() => {
    if (!init) return
    const img = new Image()
    img.onload = () => {
      imageRef.current = img
    }
    img.src = init.snapshot.dataUrl
    return () => {
      img.onload = null
      if (imageRef.current === img) imageRef.current = null
      img.src = ''
    }
  }, [init])

  useEffect(
    () =>
      api.capture.onOverlayRelease(() => {
        releaseSnapshot()
        setInit(null)
        setWindows(null)
        setBox(null)
        setEditorVisibility(NO_EDITOR)
        setEditorBusy(false)
      }),
    [releaseSnapshot]
  )

  const loadWindowPreview = useCallback(async (id: string) => {
    if (previewKnownRef.current.has(id) || previewInFlightRef.current.has(id)) return
    previewInFlightRef.current.add(id)
    try {
      const thumbnail = await api.capture.windowPreview(id)
      if (!thumbnail) return
      previewKnownRef.current.add(id)
      previewOrderRef.current = previewOrderRef.current.filter((item) => item !== id)
      previewOrderRef.current.push(id)
      const evict =
        previewOrderRef.current.length > 12 ? previewOrderRef.current.shift() : undefined
      if (evict) previewKnownRef.current.delete(evict)
      setWindows(
        (current) =>
          current?.map((win) =>
            win.id === id
              ? { ...win, thumbnail }
              : win.id === evict
                ? { ...win, thumbnail: undefined }
                : win
          ) ?? null
      )
    } finally {
      previewInFlightRef.current.delete(id)
    }
  }, [])

  const queueWindowPreview = useCallback(
    (id: string) => {
      if (
        previewKnownRef.current.has(id) ||
        previewInFlightRef.current.has(id) ||
        previewQueueRef.current.includes(id)
      )
        return
      // Hovered/focused cards should take precedence over the initial fill.
      previewQueueRef.current.unshift(id)
      if (previewWorkerRef.current) return
      previewWorkerRef.current = true
      void (async () => {
        while (previewQueueRef.current.length > 0) {
          const next = previewQueueRef.current.shift()
          if (next) await loadWindowPreview(next)
        }
        previewWorkerRef.current = false
      })()
    },
    [loadWindowPreview]
  )

  const refreshWindows = useCallback(async () => {
    const request = ++windowsRequestRef.current
    setWindows(null)
    previewKnownRef.current.clear()
    previewInFlightRef.current.clear()
    previewOrderRef.current = []
    previewQueueRef.current = []
    const items = await api.capture.windows()
    if (request !== windowsRequestRef.current) return
    setWindows(items)
    previewKnownRef.current = new Set(items.filter((item) => item.thumbnail).map((item) => item.id))
    // ScreenCaptureKit is stable when `screencapture -l` requests are serial. Fill
    // the first visible row automatically so the picker is useful immediately, then
    // retain hover/focus loading for the rest without creating a preview storm.
    for (const item of items
      .filter((item) => !item.thumbnail)
      .slice(0, 4)
      .reverse()) {
      queueWindowPreview(item.id)
    }
  }, [queueWindowPreview])

  useEffect(() => {
    if (init?.mode !== 'window') return
    void refreshWindows()
    return () => {
      windowsRequestRef.current++
    }
  }, [init?.mode, refreshWindows])

  const scale = init ? init.snapshot.pixelWidth / window.innerWidth : 1
  const cssW = window.innerWidth
  const cssH = window.innerHeight

  /* ---------- colour sampling ---------- */

  const sampleAt = useCallback(
    (x: number, y: number): string => {
      let ctx = pixelsRef.current
      // Only the display the pointer actually visits needs a readback canvas. Previously
      // every monitor allocated a full-resolution copy before the user moved the mouse.
      if (!ctx && imageRef.current) {
        const image = imageRef.current
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(image, 0, 0)
          pixelsRef.current = ctx
        }
      }
      if (!ctx) return '#000000'
      const px = Math.round(x * scale)
      const py = Math.round(y * scale)
      try {
        const d = ctx.getImageData(px, py, 1, 1).data
        return `#${[d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`
      } catch {
        return '#000000'
      }
    },
    [scale]
  )

  /* ---------- loupe ---------- */

  useEffect(() => {
    const canvas = loupeRef.current
    const ctx = pixelsRef.current
    if (!canvas || !ctx || !init) return
    const g = canvas.getContext('2d')
    if (!g) return

    const size = 132
    const zoom = 8
    const src = size / zoom // source pixels sampled

    g.imageSmoothingEnabled = false
    g.clearRect(0, 0, size, size)
    const sx = Math.round(cursor.x * scale - src / 2)
    const sy = Math.round(cursor.y * scale - src / 2)
    try {
      g.drawImage(ctx.canvas, sx, sy, src, src, 0, 0, size, size)
    } catch {
      /* cursor outside the snapshot */
    }

    // Pixel grid, drawn with a difference blend so it stays visible over white
    // pixels as well as black ones.
    g.save()
    g.globalCompositeOperation = 'difference'
    g.strokeStyle = 'rgba(255,255,255,0.22)'
    g.lineWidth = 1
    g.beginPath()
    for (let i = zoom; i < size; i += zoom) {
      g.moveTo(i + 0.5, 0)
      g.lineTo(i + 0.5, size)
      g.moveTo(0, i + 0.5)
      g.lineTo(size, i + 0.5)
    }
    g.stroke()
    g.restore()

    // Centre reticle: a white square ringed in black reads on any pixel underneath.
    const c = Math.floor(size / 2 / zoom) * zoom
    g.strokeStyle = '#000'
    g.lineWidth = 3
    g.strokeRect(c + 0.5, c + 0.5, zoom, zoom)
    g.strokeStyle = '#fff'
    g.lineWidth = 1.5
    g.strokeRect(c + 0.5, c + 0.5, zoom, zoom)
  }, [cursor, scale, init])

  /* ---------- pointer handling ---------- */

  const onPointerDown = (e: React.PointerEvent) => {
    if (init?.mode === 'window') return
    if (e.button !== 0) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const point = { x: e.clientX, y: e.clientY }
    dragStart.current = point
    setDragging(true)
    setBox({ x: point.x, y: point.y, w: 0, h: 0 })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const point = { x: e.clientX, y: e.clientY }
    setCursor(point)
    setHex(sampleAt(point.x, point.y))

    if (moveRef.current) {
      const { handle, origin, from } = moveRef.current
      const dx = point.x - from.x
      const dy = point.y - from.y
      setBox(clampBox(applyHandle(origin, handle, dx, dy), cssW, cssH))
      return
    }

    if (dragging && dragStart.current) {
      let end = point
      // Shift constrains to a square, matching every design tool's muscle memory.
      if (e.shiftKey) {
        const side = Math.max(
          Math.abs(point.x - dragStart.current.x),
          Math.abs(point.y - dragStart.current.y)
        )
        end = {
          x: dragStart.current.x + Math.sign(point.x - dragStart.current.x) * side,
          y: dragStart.current.y + Math.sign(point.y - dragStart.current.y) * side
        }
      }
      setBox(clampBox(normalize(dragStart.current, end), cssW, cssH))
    }
  }

  const onPointerUp = () => {
    moveRef.current = null
    if (!dragging) return
    setDragging(false)
    dragStart.current = null
    setBox((b) => {
      if (!b) return b
      // A click with no drag means "cancel", not "capture a 0x0 region".
      if (b.w < 4 || b.h < 4) return null
      return b
    })
  }

  const beginHandle = (handle: Handle | 'move') => (e: React.PointerEvent) => {
    e.stopPropagation()
    if (!box) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    moveRef.current = { handle, origin: box, from: { x: e.clientX, y: e.clientY } }
  }

  /* ---------- commit / cancel ---------- */

  const commit = useCallback(() => {
    if (!init || !box || box.w < 2 || box.h < 2) return
    api.capture.submitSelection({
      displayId: init.snapshot.displayId,
      // Selection is in CSS pixels; the snapshot is native pixels.
      rect: { x: box.x * scale, y: box.y * scale, width: box.w * scale, height: box.h * scale },
      screenRect: {
        x: init.snapshot.bounds.x + box.x,
        y: init.snapshot.bounds.y + box.y,
        width: box.w,
        height: box.h
      },
      mode: init.mode
    })
  }, [box, init, scale])

  const cancel = useCallback(() => api.capture.cancel(), [])

  const toggleEditors = useCallback(async () => {
    if (!editorVisibility.available || editorBusy) return
    setEditorBusy(true)
    try {
      const next = await api.capture.setEditorsVisible(!editorVisibility.visible)
      setEditorVisibility(next)
      if (init?.mode === 'window') await refreshWindows()
    } catch (error) {
      console.error('[clipthat] editor visibility toggle failed', error)
    } finally {
      setEditorBusy(false)
    }
  }, [editorBusy, editorVisibility, init?.mode, refreshWindows])

  const pickWindow = (id: string) => {
    if (!init) return
    api.capture.submitSelection({
      displayId: init.snapshot.displayId,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      screenRect: { x: 0, y: 0, width: 0, height: 0 },
      mode: 'window',
      windowId: id
    })
  }

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (box) commit()
        return
      }
      if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey) {
        void navigator.clipboard.writeText(hex)
        return
      }
      if (
        e.key.toLowerCase() === 'e' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        editorVisibility.available
      ) {
        e.preventDefault()
        void toggleEditors()
        return
      }
      if (e.key.toLowerCase() === 'a' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setBox({ x: 0, y: 0, w: cssW, h: cssH })
        return
      }
      if (box && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        // Alt resizes from the bottom-right; plain arrows move the whole box.
        setBox((b) =>
          b
            ? clampBox(
                e.altKey
                  ? { ...b, w: Math.max(1, b.w + dx), h: Math.max(1, b.h + dy) }
                  : { ...b, x: b.x + dx, y: b.y + dy },
                cssW,
                cssH
              )
            : b
        )
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [box, cancel, commit, cssH, cssW, editorVisibility.available, hex, toggleEditors])

  /* ---------- render ---------- */

  if (!init) return null

  const px = (n: number) => Math.round(n * scale)
  const loupeSide = cursor.x > cssW - 190 ? cursor.x - 176 : cursor.x + 22
  const loupeTop = cursor.y > cssH - 210 ? cursor.y - 196 : cursor.y + 22
  const editorToggle = editorVisibility.available ? (
    <button
      className="btn sm ov-editor-toggle"
      type="button"
      aria-pressed={editorVisibility.visible}
      disabled={editorBusy}
      title={`${editorVisibility.visible ? 'Hide' : 'Show'} editor (E)`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => void toggleEditors()}
    >
      <Icon name={editorVisibility.visible ? 'eye' : 'eyeOff'} size={14} />
      {editorBusy ? 'Updating…' : editorVisibility.visible ? 'Editor visible' : 'Editor hidden'}
      <span className="kbd">E</span>
    </button>
  ) : null

  if (init.mode === 'window') {
    return (
      <div className="ov ov-window" style={{ backgroundImage: `url(${init.snapshot.dataUrl})` }}>
        <div className="ov-window-scrim" />
        <div className="ov-picker">
          <header>
            <Icon name="window" size={18} />
            <h1>Pick a window</h1>
            <span className="spacer" />
            {editorToggle}
            <button
              className="btn ghost icon"
              onClick={cancel}
              title="Cancel (Esc)"
              aria-label="Cancel capture"
            >
              <Icon name="close" />
            </button>
          </header>
          {!windows && <div className="ov-loading">Looking for windows…</div>}
          {windows && windows.length === 0 && (
            <div className="ov-loading">No capturable windows were found.</div>
          )}
          <div className="ov-grid">
            {windows?.map((w) => (
              <button
                key={w.id}
                className="ov-card"
                onClick={() => pickWindow(w.id)}
                onMouseEnter={() => queueWindowPreview(w.id)}
                onFocus={() => queueWindowPreview(w.id)}
              >
                <div className="ov-card-shot">
                  {w.thumbnail ? (
                    <img src={w.thumbnail} alt="" />
                  ) : (
                    <Icon name="window" size={28} />
                  )}
                </div>
                <div className="ov-card-meta">
                  {w.icon && <img className="ov-card-icon" src={w.icon} alt="" />}
                  <div style={{ minWidth: 0 }}>
                    <div className="truncate">{w.title}</div>
                    <div className="tiny muted truncate">{w.appName}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`ov ${box ? 'has-box' : ''}`}
      style={{ backgroundImage: `url(${init.snapshot.dataUrl})` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => {
        e.preventDefault()
        cancel()
      }}
    >
      {editorToggle && <div className="ov-editor-control">{editorToggle}</div>}

      {/* Dim everything, then punch a hole for the selection. */}
      <div className="ov-scrim">
        {box && (
          <div
            className="ov-hole"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          />
        )}
      </div>

      {/* Crosshair guides */}
      {!box && cursor.x > -500 && (
        <>
          <div className="ov-guide v" style={{ left: cursor.x }} />
          <div className="ov-guide h" style={{ top: cursor.y }} />
        </>
      )}

      {box && (
        <div
          className="ov-box"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          onPointerDown={beginHandle('move')}
        >
          <div className="ov-thirds" />
          {!dragging &&
            HANDLES.map((h) => (
              <span key={h} className={`ov-handle ${h}`} onPointerDown={beginHandle(h)} />
            ))}
        </div>
      )}

      {/* Size readout */}
      {box && (
        <div
          className="ov-size mono"
          style={{
            left: Math.min(cssW - 130, Math.max(6, box.x)),
            top: box.y > 34 ? box.y - 30 : box.y + box.h + 8
          }}
        >
          {px(box.w)} × {px(box.h)}
          {scale !== 1 && <span className="ov-size-pt"> @{scale}x</span>}
        </div>
      )}

      {/* Loupe + eyedropper */}
      {!box && (
        <div className="ov-loupe" style={{ left: loupeSide, top: loupeTop }}>
          <canvas ref={loupeRef} width={132} height={132} />
          <div className="ov-loupe-foot mono">
            <span className="ov-swatch" style={{ background: hex }} />
            {hex.toUpperCase()}
          </div>
          <div className="ov-loupe-pos mono tiny">
            {px(cursor.x)}, {px(cursor.y)}
          </div>
        </div>
      )}

      {/* Confirm bar */}
      {box && !dragging && (
        <div
          className="ov-actions"
          style={{
            left: Math.min(cssW - 240, Math.max(8, box.x + box.w - 232)),
            top: box.y + box.h + 10 > cssH - 50 ? Math.max(8, box.y - 46) : box.y + box.h + 10
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button className="btn sm ghost" onClick={cancel}>
            <Icon name="close" size={14} /> Cancel
          </button>
          <div className="ov-actions-sep" />
          <button className="btn sm primary" onClick={commit}>
            <Icon name={init.mode === 'scrolling' ? 'scroll' : 'check'} size={14} />
            {init.mode === 'scrolling' ? 'Start' : 'Capture'}
          </button>
        </div>
      )}

      {!box && (
        <div className="ov-hint">
          <span>
            <b>Drag</b> to select
          </span>
          <span>
            <span className="kbd">⌘A</span> whole screen
          </span>
          <span>
            <span className="kbd">C</span> copy colour
          </span>
          {editorVisibility.available && (
            <span>
              <span className="kbd">E</span> {editorVisibility.visible ? 'hide' : 'show'} editor
            </span>
          )}
          <span>
            <span className="kbd">Esc</span> cancel
          </span>
        </div>
      )}
    </div>
  )
}

function applyHandle(origin: Box, handle: Handle | 'move', dx: number, dy: number): Box {
  if (handle === 'move') return { ...origin, x: origin.x + dx, y: origin.y + dy }

  let { x, y, w, h } = origin
  if (handle.includes('n')) {
    y = origin.y + dy
    h = origin.h - dy
  }
  if (handle.includes('s')) h = origin.h + dy
  if (handle.includes('w')) {
    x = origin.x + dx
    w = origin.w - dx
  }
  if (handle.includes('e')) w = origin.w + dx

  // Dragging a handle past the opposite edge flips the box rather than inverting it.
  if (w < 0) {
    x += w
    w = -w
  }
  if (h < 0) {
    y += h
    h = -h
  }
  return { x, y, w, h }
}
