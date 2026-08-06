import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { BoxShape, Shape } from '@shared/types'
import { api } from '../../shared/api'
import { Icon, type IconName } from '../../shared/icons'
import { toast } from '../../shared/ui'
import { runOcr, toImageSpace } from '../../shared/ocr'
import {
  detectTable,
  extractEntities,
  extractPalette,
  findSensitive,
  suggestTitle,
  SENSITIVE_LABELS,
  type Entity,
  type Swatch
} from '../../shared/extract'
import { orderWords, selectedText } from '../canvas/LiveText'
import { useEditor } from '../store'

const ENTITY_ICON: Record<Entity['kind'], IconName> = {
  url: 'externalLink',
  email: 'type',
  phone: 'info',
  ip: 'monitor',
  color: 'sparkles',
  money: 'info',
  date: 'clock'
}

/**
 * Everything ClipThat could work out about the capture, in one place: the text, the
 * things you'd want to copy or open, the table, the palette, and what should be hidden.
 */
export default function ContextPanel({ image }: { image: HTMLImageElement | null }): React.ReactElement {
  const doc = useEditor((s) => s.doc)
  const ocr = useEditor((s) => s.ocr)
  const busy = useEditor((s) => s.ocrBusy)
  const liveText = useEditor((s) => s.liveTextOn)
  const liveSelection = useEditor((s) => s.liveSelection)
  const [palette, setPalette] = useState<Swatch[]>([])

  const analyse = useCallback(async () => {
    const state = useEditor.getState()
    const current = state.doc
    if (!current || state.ocrBusy) return
    state.setOcrBusy(true)
    try {
      const region = current.crop.enabled ? current.crop : undefined
      const result = await runOcr(current.image, region)
      state.setOcr(toImageSpace(result, region))
      state.setOcrText(result.text.trim())
    } catch (err) {
      toast('error', 'Could not read the capture', (err as Error).message)
    } finally {
      useEditor.getState().setOcrBusy(false)
    }
  }, [])

  // Run once when the panel is first opened for a document.
  useEffect(() => {
    if (!ocr && !busy && doc) void analyse()
  }, [doc?.id])

  useEffect(() => {
    if (image) setPalette(extractPalette(image))
  }, [image])

  const entities = useMemo(() => (ocr ? extractEntities(ocr) : []), [ocr])
  const table = useMemo(() => (ocr ? detectTable(ocr) : null), [ocr])
  const sensitive = useMemo(() => (ocr ? findSensitive(ocr) : []), [ocr])
  const words = useMemo(() => (ocr ? orderWords(ocr.words) : []), [ocr])
  const title = useMemo(
    () => (ocr && doc ? suggestTitle(ocr, doc.imageHeight) : null),
    [ocr, doc?.imageHeight]
  )

  const grouped = useMemo(() => {
    const map = new Map<Entity['kind'], Entity[]>()
    for (const e of entities) {
      const list = map.get(e.kind) ?? []
      list.push(e)
      map.set(e.kind, list)
    }
    return [...map.entries()]
  }, [entities])

  const copy = async (value: string, label = 'Copied') => {
    await navigator.clipboard.writeText(value)
    toast('success', label)
  }

  /** Drop a blur over every sensitive hit found. */
  const blurAll = () => {
    const state = useEditor.getState()
    const current = state.doc
    if (!current || sensitive.length === 0) return
    state.begin()
    let z = current.shapes.reduce((m, s) => Math.max(m, s.z), 0)
    const pad = 3
    const shapes: BoxShape[] = sensitive.map((m) => ({
      id: crypto.randomUUID(),
      type: 'blur',
      z: ++z,
      x: m.bbox.x - pad,
      y: m.bbox.y - pad,
      width: m.bbox.width + pad * 2,
      height: m.bbox.height + pad * 2,
      intensity: 22,
      stroke: 'transparent',
      strokeWidth: 0
    }))
    useEditor.setState((s) =>
      s.doc
        ? {
            doc: { ...s.doc, shapes: [...s.doc.shapes, ...(shapes as Shape[])] },
            selectedIds: shapes.map((s2) => s2.id),
            dirty: true
          }
        : s
    )
    toast('success', `Blurred ${shapes.length} item${shapes.length === 1 ? '' : 's'}`)
  }

  /** Frame a single entity with a highlight rectangle. */
  const highlight = (entity: Entity) => {
    const state = useEditor.getState()
    const current = state.doc
    if (!current) return
    state.begin()
    const pad = 4
    state.addShape(
      {
        id: crypto.randomUUID(),
        type: 'rect',
        z: current.shapes.reduce((m, s) => Math.max(m, s.z), 0) + 1,
        x: entity.bbox.x - pad,
        y: entity.bbox.y - pad,
        width: entity.bbox.width + pad * 2,
        height: entity.bbox.height + pad * 2,
        stroke: state.style.color,
        strokeWidth: Math.max(2, state.style.strokeWidth),
        cornerRadius: 3,
        shadow: false
      } as Shape,
      { history: false }
    )
  }

  const selected = selectedText(words, liveSelection)

  return (
    <div className="ctx">
      <div className="ctx-head">
        <button className="btn sm ghost" onClick={() => void analyse()} disabled={busy}>
          <Icon name="refresh" size={13} className={busy ? 'spin' : undefined} />
          {busy ? 'Reading…' : 'Re-read'}
        </button>
        <span className="spacer" />
        <button
          className={`btn sm ${liveText ? 'primary' : 'ghost'}`}
          onClick={() => useEditor.getState().setLiveText(!liveText)}
          disabled={!ocr || words.length === 0}
        >
          <Icon name="type" size={13} /> Live Text
        </button>
      </div>

      {busy && !ocr && (
        <div className="ctx-empty">
          <Icon name="refresh" size={20} className="spin" />
          Reading the capture…
        </div>
      )}

      {ocr && words.length === 0 && !busy && (
        <div className="ctx-empty">
          <Icon name="info" size={20} />
          No text found in this capture.
        </div>
      )}

      {liveText && (
        <div className="ctx-live">
          {selected ? (
            <>
              <div className="ctx-live-text">{selected}</div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm primary" onClick={() => void copy(selected)}>
                  <Icon name="copy" size={13} /> Copy selection
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => useEditor.getState().setLiveSelection(null)}
                >
                  Clear
                </button>
              </div>
            </>
          ) : (
            <div className="tiny muted">
              Drag across the words in the capture to select them, then press ⌘C.
            </div>
          )}
        </div>
      )}

      {sensitive.length > 0 && (
        <Section
          icon="shield"
          title="Sensitive data"
          accent="warn"
          count={sensitive.length}
          action={
            <button className="btn sm primary" onClick={blurAll}>
              Blur all
            </button>
          }
        >
          {sensitive.slice(0, 8).map((m, i) => (
            <div key={i} className="ctx-row">
              <span className="ctx-kind">{SENSITIVE_LABELS[m.kind]}</span>
              <span className="ctx-value mono truncate">{m.text}</span>
            </div>
          ))}
          {sensitive.length > 8 && (
            <div className="tiny muted">+{sensitive.length - 8} more</div>
          )}
        </Section>
      )}

      {title && doc && title !== doc.title && (
        <Section icon="sparkles" title="Suggested name">
          <div className="ctx-row">
            <span className="ctx-value truncate">{title}</span>
            <button className="btn sm" onClick={() => useEditor.getState().setTitle(title)}>
              Use
            </button>
          </div>
        </Section>
      )}

      {table && (
        <Section icon="grid" title="Table" count={`${table.rows.length}×${table.columns}`}>
          <div className="ctx-table-preview mono tiny">
            {table.rows.slice(0, 4).map((row, i) => (
              <div key={i} className="truncate">
                {row.join('  ·  ')}
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => void copy(table.markdown, 'Markdown copied')}>
              <Icon name="copy" size={13} /> Markdown
            </button>
            <button className="btn sm" onClick={() => void copy(table.csv, 'CSV copied')}>
              <Icon name="copy" size={13} /> CSV
            </button>
          </div>
        </Section>
      )}

      {grouped.map(([kind, items]) => (
        <Section key={kind} icon={ENTITY_ICON[kind]} title={labelFor(kind)} count={items.length}>
          {items.slice(0, 12).map((entity, i) => (
            <div key={`${entity.text}-${i}`} className="ctx-row">
              {kind === 'color' && (
                <span className="ctx-chip" style={{ background: entity.text }} />
              )}
              <span className="ctx-value mono truncate" title={entity.text}>
                {entity.text}
              </span>
              <button
                className="btn sm ghost icon tip"
                data-tip="Highlight in the image"
                onClick={() => highlight(entity)}
              >
                <Icon name="rect" size={13} />
              </button>
              <button
                className="btn sm ghost icon tip"
                data-tip="Copy"
                onClick={() => void copy(entity.value ?? entity.text)}
              >
                <Icon name="copy" size={13} />
              </button>
              {kind === 'url' && (
                <button
                  className="btn sm ghost icon tip"
                  data-tip="Open in browser"
                  onClick={() => void api.system.openExternal(entity.value ?? entity.text)}
                >
                  <Icon name="externalLink" size={13} />
                </button>
              )}
            </div>
          ))}
        </Section>
      ))}

      {palette.length > 0 && (
        <Section icon="sparkles" title="Palette">
          <div className="ctx-palette">
            {palette.map((s) => (
              <button
                key={s.hex}
                className="ctx-swatch"
                style={{ background: s.hex }}
                title={`${s.hex} · ${Math.round(s.share * 100)}%`}
                onClick={() => void copy(s.hex, `${s.hex} copied`)}
              />
            ))}
          </div>
          <div className="tiny muted">Click a swatch to copy its hex.</div>
        </Section>
      )}

      {ocr && ocr.text.trim() && (
        <Section icon="type" title="All text" count={`${words.length} words`}>
          <textarea className="field ctx-text" rows={7} readOnly value={ocr.text.trim()} />
          <button className="btn sm" onClick={() => void copy(ocr.text.trim(), 'Text copied')}>
            <Icon name="copy" size={13} /> Copy all text
          </button>
        </Section>
      )}
    </div>
  )
}

function labelFor(kind: Entity['kind']): string {
  const map: Record<Entity['kind'], string> = {
    url: 'Links',
    email: 'Email addresses',
    phone: 'Phone numbers',
    ip: 'IP addresses',
    color: 'Colour codes',
    money: 'Amounts',
    date: 'Dates'
  }
  return map[kind]
}

function Section(props: {
  icon: IconName
  title: string
  count?: number | string
  accent?: 'warn'
  action?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className={`ctx-section ${props.accent ?? ''}`}>
      <header>
        <Icon name={props.icon} size={13} />
        <span>{props.title}</span>
        {props.count !== undefined && <span className="ctx-count">{props.count}</span>}
        <span className="spacer" />
        {props.action}
      </header>
      <div className="ctx-body">{props.children}</div>
    </section>
  )
}
