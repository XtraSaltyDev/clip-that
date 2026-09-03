import React, { useEffect, useRef, useState } from 'react'
import { api } from '../../shared/api'
import { Icon } from '../../shared/icons'
import { useEditor } from '../store'
import type { EditorActions } from '../actions'
import type { CutOutAxis, CutOutEdge } from '@shared/types'
import { isValidCutOutSelection } from '@shared/cut-out'
import { nextMenuIndex } from '../responsive'
import { MOD_KEY } from '../../shared/platform'

export default function TopBar({
  actions,
  onOpenPalette,
  onShowInspector
}: {
  actions: EditorActions
  onOpenPalette: () => void
  onShowInspector: () => void
}): React.ReactElement {
  const doc = useEditor((s) => s.doc)
  const past = useEditor((s) => s.past.length)
  const future = useEditor((s) => s.future.length)
  const zoom = useEditor((s) => s.zoom)
  const dirty = useEditor((s) => s.dirty)
  const tool = useEditor((s) => s.tool)
  const cropDraft = useEditor((s) => s.cropDraft)
  const cutOutDraft = useEditor((s) => s.cutOutDraft)
  const cutOutAxis = useEditor((s) => s.cutOutAxis)
  const cutOutEdge = useEditor((s) => s.cutOutEdge)
  const ocrBusy = useEditor((s) => s.ocrBusy)
  const panel = useEditor((s) => s.panel)
  const {
    begin,
    end,
    undo,
    redo,
    setZoom,
    applyCrop,
    applyCutOut,
    setCutOutOptions,
    setTool,
    setTitle,
    setPanel
  } = useEditor.getState()

  const [menu, setMenu] = useState<'export' | 'capture' | 'zoom' | 'more' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  useEffect(() => {
    if (!menu) return
    requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menu"] button')?.focus()
    )
  }, [menu])

  const closeMenu = () => {
    const trigger = document.querySelector<HTMLButtonElement>(`[data-menu-trigger="${menu}"]`)
    setMenu(null)
    requestAnimationFrame(() => trigger?.focus())
  }

  const menuKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    )
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next = current
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      next = nextMenuIndex(
        current,
        buttons.length,
        event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'
      )
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      return
    } else return
    event.preventDefault()
    buttons[next]?.focus()
  }

  if (!doc) return <header className="topbar" />

  return (
    <header className="topbar drag-region">
      <div className="topbar-left no-drag">
        <button
          className="btn ghost icon tip"
          data-tip={`Undo  ·  ${MOD_KEY}Z`}
          aria-label="Undo"
          disabled={past === 0}
          onClick={undo}
        >
          <Icon name="undo" />
        </button>
        <button
          className="btn ghost icon tip"
          data-tip={`Redo  ·  Shift+${MOD_KEY}Z`}
          aria-label="Redo"
          disabled={future === 0}
          onClick={redo}
        >
          <Icon name="redo" />
        </button>

        <div className="topbar-sep" />

        <div className="zoombox topbar-wide-zoom">
          <button
            className="btn ghost icon sm"
            aria-label="Zoom out"
            onClick={() => setZoom(zoom / 1.25)}
          >
            <Icon name="zoomOut" size={14} />
          </button>
          <button className="zoomval mono" onClick={() => setZoom(1)} title="Reset to 100%">
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="btn ghost icon sm"
            aria-label="Zoom in"
            onClick={() => setZoom(zoom * 1.25)}
          >
            <Icon name="zoomIn" size={14} />
          </button>
          <button
            className="btn ghost icon sm tip"
            data-tip={`Fit to window  ·  ${MOD_KEY}0`}
            aria-label="Fit to window"
            onClick={() => setZoom(zoom, true)}
          >
            <Icon name="fit" size={14} />
          </button>
        </div>
        <div
          className="menu-anchor topbar-compact-only"
          ref={menu === 'zoom' ? menuRef : undefined}
        >
          <button
            className="btn compact-zoom"
            data-menu-trigger="zoom"
            aria-label={`Zoom, ${Math.round(zoom * 100)} percent`}
            aria-haspopup="menu"
            aria-expanded={menu === 'zoom'}
            onClick={() => setMenu(menu === 'zoom' ? null : 'zoom')}
          >
            <Icon name="zoomIn" size={14} />
            <span className="mono">{Math.round(zoom * 100)}%</span>
            <Icon name="chevronDown" size={12} />
          </button>
          {menu === 'zoom' && (
            <div className="menu compact-zoom-menu" role="menu" onKeyDown={menuKeys}>
              <button
                role="menuitem"
                onClick={() => {
                  setZoom(zoom / 1.25)
                  setMenu(null)
                }}
              >
                <Icon name="zoomOut" size={14} /> Zoom out
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setZoom(1)
                  setMenu(null)
                }}
              >
                <Icon name="refresh" size={14} /> Actual size (100%)
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setZoom(zoom * 1.25)
                  setMenu(null)
                }}
              >
                <Icon name="zoomIn" size={14} /> Zoom in
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setZoom(zoom, true)
                  setMenu(null)
                }}
              >
                <Icon name="fit" size={14} /> Fit to window
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="topbar-title no-drag">
        <input
          className="title-input"
          value={doc.title}
          title={doc.title}
          aria-label="Capture title"
          spellCheck={false}
          onFocus={begin}
          onBlur={end}
          onChange={(e) => setTitle(e.target.value)}
        />
        {dirty && <span className="dot-dirty" title="Unsaved changes" />}
      </div>

      <div className="topbar-right no-drag">
        {tool === 'cutOut' && (
          <>
            <select
              className="cutout-control"
              aria-label="Cut Out direction"
              value={cutOutAxis}
              onChange={(event) => setCutOutOptions({ axis: event.target.value as CutOutAxis })}
            >
              <option value="horizontal">Horizontal band</option>
              <option value="vertical">Vertical band</option>
            </select>
            <select
              className="cutout-control"
              aria-label="Cut Out edge"
              value={cutOutEdge}
              onChange={(event) => setCutOutOptions({ edge: event.target.value as CutOutEdge })}
            >
              <option value="straight">Straight edge</option>
              <option value="zigzag">Zigzag edge</option>
              <option value="wave">Wave edge</option>
              <option value="triangle">Triangle edge</option>
            </select>
            <button
              className="btn sm primary"
              disabled={!cutOutDraft || !isValidCutOutSelection(cutOutDraft)}
              onClick={() => cutOutDraft && applyCutOut(cutOutDraft)}
            >
              <Icon name="check" size={14} /> Apply Cut Out
            </button>
            <button className="btn sm ghost" onClick={() => setTool('select')}>
              Cancel
            </button>
            <div className="topbar-sep" />
          </>
        )}
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
          className={`btn ghost tip topbar-expanded-action ${panel === 'context' ? 'context-active' : ''}`}
          data-tip="Screen context — text, links, tables, colours"
          aria-pressed={panel === 'context'}
          onClick={() => {
            setPanel(panel === 'context' ? 'inspect' : 'context')
            onShowInspector()
          }}
        >
          <Icon name="sparkles" size={14} className={ocrBusy ? 'spin' : undefined} />
          Context
        </button>
        <button
          className="btn ghost icon tip topbar-expanded-action"
          data-tip="Auto-blur sensitive data"
          aria-label="Auto-blur sensitive data"
          disabled={ocrBusy}
          onClick={() => void actions.autoRedact()}
        >
          <Icon name="shield" />
        </button>
        <button
          className="btn ghost icon tip topbar-expanded-action"
          data-tip={`Command palette  ·  ${MOD_KEY}K`}
          aria-label="Command palette"
          onClick={onOpenPalette}
        >
          <Icon name="search" />
        </button>

        <div className="topbar-sep topbar-expanded-action" />

        <button
          className="btn ghost tip topbar-expanded-action"
          data-tip="Drag me into another app"
          draggable
          onDragStart={(e) => {
            e.preventDefault()
            void actions.dragOut()
          }}
        >
          <Icon name="image" size={14} /> Drag out
        </button>

        <button
          className="btn tip"
          data-tip={`Copy  ·  ${MOD_KEY}C`}
          onClick={() => void actions.copy()}
        >
          <Icon name="copy" size={14} /> Copy
        </button>

        <div className="menu-anchor" ref={menu === 'export' ? menuRef : undefined}>
          <button className="btn primary" onClick={() => void actions.save(false)}>
            <Icon name="download" size={14} /> Save
          </button>
          <button
            className="btn primary split"
            data-menu-trigger="export"
            aria-haspopup="menu"
            aria-expanded={menu === 'export'}
            onClick={() => setMenu(menu === 'export' ? null : 'export')}
            aria-label="More export options"
          >
            <Icon name="chevronDown" size={13} />
          </button>
          {menu === 'export' && (
            <div className="menu" role="menu" onKeyDown={menuKeys}>
              <button
                onClick={() => {
                  setMenu(null)
                  void actions.save(true)
                }}
              >
                <Icon name="save" size={14} /> Save as…
              </button>
              <div className="menu-sep" />
              <button
                onClick={() => {
                  setMenu(null)
                  void actions.exportAs('png')
                }}
              >
                PNG
              </button>
              <button
                onClick={() => {
                  setMenu(null)
                  void actions.exportAs('jpg')
                }}
              >
                JPEG
              </button>
              <button
                onClick={() => {
                  setMenu(null)
                  void actions.exportAs('webp')
                }}
              >
                WebP
              </button>
              <button
                onClick={() => {
                  setMenu(null)
                  void actions.exportAs('pdf')
                }}
              >
                PDF
              </button>
              <div className="menu-sep" />
              <button
                onClick={() => {
                  setMenu(null)
                  void actions.print()
                }}
              >
                <Icon name="print" size={14} /> Print <span className="kbd">{MOD_KEY}P</span>
              </button>
              <div className="menu-sep" />
              <button
                onClick={() => {
                  setMenu(null)
                  void actions.exportAs('project')
                }}
              >
                <Icon name="layers" size={14} /> Editable project (.clipthat)
              </button>
              <div className="menu-sep" />
              <button
                onClick={() => {
                  setMenu(null)
                  void actions.pinToScreen()
                }}
              >
                <Icon name="lock" size={14} /> Pin to screen
              </button>
            </div>
          )}
        </div>

        <div className="topbar-sep topbar-expanded-action" />

        <div
          className="menu-anchor topbar-expanded-action"
          ref={menu === 'capture' ? menuRef : undefined}
        >
          <button
            className="btn ghost icon tip"
            data-tip="New capture"
            aria-label="New capture"
            data-menu-trigger="capture"
            aria-haspopup="menu"
            aria-expanded={menu === 'capture'}
            onClick={() => setMenu(menu === 'capture' ? null : 'capture')}
          >
            <Icon name="plus" />
          </button>
          {menu === 'capture' && (
            <div className="menu right" role="menu" onKeyDown={menuKeys}>
              <button
                onClick={() => {
                  setMenu(null)
                  void api.capture.start({ mode: 'region' })
                }}
              >
                <Icon name="region" size={14} /> Region
              </button>
              <button
                onClick={() => {
                  setMenu(null)
                  void api.capture.start({ mode: 'window' })
                }}
              >
                <Icon name="window" size={14} /> Window
              </button>
              <button
                onClick={() => {
                  setMenu(null)
                  void api.capture.start({ mode: 'display' })
                }}
              >
                <Icon name="monitor" size={14} /> Whole screen
              </button>
              <button
                onClick={() => {
                  setMenu(null)
                  void api.capture.start({ mode: 'scrolling' })
                }}
              >
                <Icon name="scroll" size={14} /> Scrolling capture
              </button>
              <div className="menu-sep" />
              <button
                onClick={() => {
                  setMenu(null)
                  void api.capture.fromClipboard()
                }}
              >
                <Icon name="clipboard" size={14} /> From clipboard
              </button>
              <button
                onClick={() => {
                  setMenu(null)
                  api.system.window('record')
                }}
              >
                <Icon name="record" size={11} /> Record screen
              </button>
            </div>
          )}
        </div>

        <button
          className="btn ghost icon tip topbar-expanded-action"
          data-tip="Library"
          aria-label="Library"
          onClick={() => api.system.window('library')}
        >
          <Icon name="grid" />
        </button>
        <button
          className="btn ghost icon tip topbar-expanded-action"
          data-tip="Settings"
          aria-label="Settings"
          onClick={() => api.system.window('settings')}
        >
          <Icon name="settings" />
        </button>

        <div
          className="menu-anchor topbar-compact-only"
          ref={menu === 'more' ? menuRef : undefined}
        >
          <button
            className="btn compact-more"
            data-menu-trigger="more"
            aria-label="More editor actions"
            aria-haspopup="menu"
            aria-expanded={menu === 'more'}
            onClick={() => setMenu(menu === 'more' ? null : 'more')}
          >
            More <Icon name="chevronDown" size={12} />
          </button>
          {menu === 'more' && (
            <div className="menu right compact-overflow" role="menu" onKeyDown={menuKeys}>
              <div className="menu-label">Workspace</div>
              <button
                data-overflow-action="context"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  setPanel(panel === 'context' ? 'inspect' : 'context')
                  onShowInspector()
                }}
              >
                <Icon name="sparkles" size={14} />{' '}
                {panel === 'context' ? 'Close Context' : 'Open Context'}
              </button>
              <button
                data-overflow-action="auto-blur"
                role="menuitem"
                disabled={ocrBusy}
                onClick={() => {
                  setMenu(null)
                  void actions.autoRedact()
                }}
              >
                <Icon name="shield" size={14} /> Auto-blur sensitive data
              </button>
              <button
                data-overflow-action="drag-out"
                role="menuitem"
                draggable
                onDragStart={(event) => {
                  event.preventDefault()
                  setMenu(null)
                  void actions.dragOut()
                }}
              >
                <Icon name="image" size={14} /> Drag out
              </button>
              <button
                data-overflow-action="command-palette"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  onOpenPalette()
                }}
              >
                <Icon name="search" size={14} /> Command palette{' '}
                <span className="kbd">{MOD_KEY}K</span>
              </button>
              <div className="menu-sep" />
              <div className="menu-label">New capture</div>
              <button
                data-overflow-action="capture-region"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  void api.capture.start({ mode: 'region' })
                }}
              >
                <Icon name="region" size={14} /> Region
              </button>
              <button
                data-overflow-action="capture-window"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  void api.capture.start({ mode: 'window' })
                }}
              >
                <Icon name="window" size={14} /> Window
              </button>
              <button
                data-overflow-action="capture-display"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  void api.capture.start({ mode: 'display' })
                }}
              >
                <Icon name="monitor" size={14} /> Whole screen
              </button>
              <button
                data-overflow-action="capture-scrolling"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  void api.capture.start({ mode: 'scrolling' })
                }}
              >
                <Icon name="scroll" size={14} /> Scrolling capture
              </button>
              <button
                data-overflow-action="capture-clipboard"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  void api.capture.fromClipboard()
                }}
              >
                <Icon name="clipboard" size={14} /> From clipboard
              </button>
              <button
                data-overflow-action="record-screen"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  api.system.window('record')
                }}
              >
                <Icon name="record" size={11} /> Record screen
              </button>
              <div className="menu-sep" />
              <button
                data-overflow-action="library"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  api.system.window('library')
                }}
              >
                <Icon name="grid" size={14} /> Library
              </button>
              <button
                data-overflow-action="settings"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  api.system.window('settings')
                }}
              >
                <Icon name="settings" size={14} /> Settings
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
