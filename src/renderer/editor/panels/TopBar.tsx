import React, { useEffect, useRef, useState } from 'react'
import { api } from '../../shared/api'
import { Icon } from '../../shared/icons'
import { useEditor } from '../store'
import type { EditorActions } from '../actions'

export default function TopBar({
  actions,
  onOpenPalette
}: {
  actions: EditorActions
  onOpenPalette: () => void
}): React.ReactElement {
  const doc = useEditor((s) => s.doc)
  const past = useEditor((s) => s.past.length)
  const future = useEditor((s) => s.future.length)
  const zoom = useEditor((s) => s.zoom)
  const dirty = useEditor((s) => s.dirty)
  const tool = useEditor((s) => s.tool)
  const cropDraft = useEditor((s) => s.cropDraft)
  const ocrBusy = useEditor((s) => s.ocrBusy)
  const panel = useEditor((s) => s.panel)
  const { undo, redo, setZoom, applyCrop, setTool, setTitle, setPanel } = useEditor.getState()

  const [menu, setMenu] = useState<'export' | 'capture' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  if (!doc) return <header className="topbar" />

  return (
    <header className="topbar drag-region">
      <div className="topbar-left no-drag">
        <button
          className="btn ghost icon tip"
          data-tip="Undo  ·  ⌘Z"
          disabled={past === 0}
          onClick={undo}
        >
          <Icon name="undo" />
        </button>
        <button
          className="btn ghost icon tip"
          data-tip="Redo  ·  ⇧⌘Z"
          disabled={future === 0}
          onClick={redo}
        >
          <Icon name="redo" />
        </button>

        <div className="topbar-sep" />

        <div className="zoombox">
          <button className="btn ghost icon sm" onClick={() => setZoom(zoom / 1.25)}>
            <Icon name="zoomOut" size={14} />
          </button>
          <button className="zoomval mono" onClick={() => setZoom(1)} title="Reset to 100%">
            {Math.round(zoom * 100)}%
          </button>
          <button className="btn ghost icon sm" onClick={() => setZoom(zoom * 1.25)}>
            <Icon name="zoomIn" size={14} />
          </button>
          <button
            className="btn ghost icon sm tip"
            data-tip="Fit to window  ·  ⌘0"
            onClick={() => setZoom(zoom, true)}
          >
            <Icon name="fit" size={14} />
          </button>
        </div>
      </div>

      <div className="topbar-title no-drag">
        <input
          className="title-input"
          value={doc.title}
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
        />
        {dirty && <span className="dot-dirty" title="Unsaved changes" />}
      </div>

      <div className="topbar-right no-drag">
        {tool === 'crop' && (
          <>
            <button
              className="btn sm primary"
              disabled={!cropDraft || cropDraft.width < 4}
              onClick={() => cropDraft && applyCrop(cropDraft)}
            >
              <Icon name="check" size={14} /> Apply crop
            </button>
            <button className="btn sm ghost" onClick={() => setTool('select')}>
              Cancel
            </button>
            <div className="topbar-sep" />
          </>
        )}

        <button
          className={`btn tip ${panel === 'context' ? 'primary' : ''}`}
          data-tip="Screen context — text, links, tables, colours"
          onClick={() => setPanel(panel === 'context' ? 'inspect' : 'context')}
        >
          <Icon name="sparkles" size={14} className={ocrBusy ? 'spin' : undefined} />
          Context
        </button>
        <button
          className="btn ghost icon tip"
          data-tip="Auto-blur sensitive data"
          disabled={ocrBusy}
          onClick={() => void actions.autoRedact()}
        >
          <Icon name="shield" />
        </button>
        <button
          className="btn ghost icon tip"
          data-tip="Command palette  ·  ⌘K"
          onClick={onOpenPalette}
        >
          <Icon name="search" />
        </button>

        <div className="topbar-sep" />

        <button
          className="btn tip"
          data-tip="Drag me into another app"
          draggable
          onDragStart={(e) => {
            e.preventDefault()
            void actions.dragOut()
          }}
        >
          <Icon name="image" size={14} /> Drag out
        </button>

        <button className="btn tip" data-tip="Copy  ·  ⌘C" onClick={() => void actions.copy()}>
          <Icon name="copy" size={14} /> Copy
        </button>

        <div className="menu-anchor" ref={menu === 'export' ? menuRef : undefined}>
          <button className="btn primary" onClick={() => void actions.save(false)}>
            <Icon name="download" size={14} /> Save
          </button>
          <button
            className="btn primary split"
            onClick={() => setMenu(menu === 'export' ? null : 'export')}
            aria-label="More export options"
          >
            <Icon name="chevronDown" size={13} />
          </button>
          {menu === 'export' && (
            <div className="menu">
              <button onClick={() => { setMenu(null); void actions.save(true) }}>
                <Icon name="save" size={14} /> Save as…
              </button>
              <div className="menu-sep" />
              <button onClick={() => { setMenu(null); void actions.exportAs('png') }}>PNG</button>
              <button onClick={() => { setMenu(null); void actions.exportAs('jpg') }}>JPEG</button>
              <button onClick={() => { setMenu(null); void actions.exportAs('webp') }}>WebP</button>
              <button onClick={() => { setMenu(null); void actions.exportAs('pdf') }}>PDF</button>
              <div className="menu-sep" />
              <button onClick={() => { setMenu(null); void actions.exportAs('project') }}>
                <Icon name="layers" size={14} /> Editable project (.clipthat)
              </button>
              <div className="menu-sep" />
              <button onClick={() => { setMenu(null); void actions.pinToScreen() }}>
                <Icon name="lock" size={14} /> Pin to screen
              </button>
            </div>
          )}
        </div>

        <div className="topbar-sep" />

        <div className="menu-anchor" ref={menu === 'capture' ? menuRef : undefined}>
          <button
            className="btn ghost icon tip"
            data-tip="New capture"
            onClick={() => setMenu(menu === 'capture' ? null : 'capture')}
          >
            <Icon name="plus" />
          </button>
          {menu === 'capture' && (
            <div className="menu right">
              <button onClick={() => { setMenu(null); void api.capture.start({ mode: 'region' }) }}>
                <Icon name="region" size={14} /> Region
              </button>
              <button onClick={() => { setMenu(null); void api.capture.start({ mode: 'window' }) }}>
                <Icon name="window" size={14} /> Window
              </button>
              <button onClick={() => { setMenu(null); void api.capture.start({ mode: 'display' }) }}>
                <Icon name="monitor" size={14} /> Whole screen
              </button>
              <button onClick={() => { setMenu(null); void api.capture.start({ mode: 'scrolling' }) }}>
                <Icon name="scroll" size={14} /> Scrolling capture
              </button>
              <div className="menu-sep" />
              <button onClick={() => { setMenu(null); void api.capture.fromClipboard() }}>
                <Icon name="clipboard" size={14} /> From clipboard
              </button>
              <button onClick={() => { setMenu(null); api.system.window('record') }}>
                <Icon name="record" size={11} /> Record screen
              </button>
            </div>
          )}
        </div>

        <button
          className="btn ghost icon tip"
          data-tip="Library"
          onClick={() => api.system.window('library')}
        >
          <Icon name="grid" />
        </button>
        <button
          className="btn ghost icon tip"
          data-tip="Settings"
          onClick={() => api.system.window('settings')}
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  )
}
