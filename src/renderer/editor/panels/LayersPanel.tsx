import React from 'react'
import type { Shape, StepShape, TextShape } from '@shared/types'
import { Icon, type IconName } from '../../shared/icons'
import { useEditor } from '../store'

const ICONS: Record<string, IconName> = {
  arrow: 'arrow',
  line: 'line',
  measure: 'measure',
  pen: 'pen',
  highlighter: 'highlighter',
  rect: 'rect',
  ellipse: 'ellipse',
  text: 'text',
  callout: 'callout',
  step: 'step',
  blur: 'blur',
  pixelate: 'pixelate',
  redact: 'redact',
  spotlight: 'spotlight',
  magnify: 'magnify'
}

function describe(shape: Shape): string {
  if (shape.type === 'text' || shape.type === 'callout') {
    const text = (shape as TextShape).text.trim()
    return text ? text.slice(0, 28) : shape.type === 'callout' ? 'Callout' : 'Text'
  }
  if (shape.type === 'step') return `Step ${(shape as StepShape).index}`
  const names: Record<string, string> = {
    arrow: 'Arrow',
    line: 'Line',
    measure: 'Measurement',
    pen: 'Pen stroke',
    highlighter: 'Highlight',
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    blur: 'Blur',
    pixelate: 'Pixelate',
    redact: 'Redaction',
    spotlight: 'Spotlight',
    magnify: 'Magnifier'
  }
  return names[shape.type] ?? 'Shape'
}

/** Top-most first, so the list reads the way the canvas stacks. */
export default function LayersPanel(): React.ReactElement {
  const doc = useEditor((s) => s.doc)
  const selectedIds = useEditor((s) => s.selectedIds)
  const { select, updateShape, removeShapes, reorder, begin, setTool } = useEditor.getState()

  const shapes = [...(doc?.shapes ?? [])].sort((a, b) => b.z - a.z)

  if (shapes.length === 0) {
    return (
      <div className="ctx-empty">
        <Icon name="layers" size={20} />
        <div>
          <div style={{ fontWeight: 600, color: 'var(--ink-1)' }}>No annotations yet</div>
          <div className="tiny">Pick a tool and draw on the capture.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="layers">
      {shapes.map((shape) => {
        const active = selectedIds.includes(shape.id)
        return (
          <div
            key={shape.id}
            className={`layer-row ${active ? 'active' : ''} ${shape.hidden ? 'hidden' : ''}`}
            onClick={(e) => {
              setTool('select')
              select(
                e.metaKey || e.ctrlKey
                  ? active
                    ? selectedIds.filter((id) => id !== shape.id)
                    : [...selectedIds, shape.id]
                  : [shape.id]
              )
            }}
          >
            <span className="layer-icon">
              <Icon name={ICONS[shape.type] ?? 'layers'} size={14} />
            </span>
            <span className="truncate" style={{ flex: 1 }}>
              {describe(shape)}
            </span>
            <button
              className="layer-btn"
              title={shape.hidden ? 'Show' : 'Hide'}
              onClick={(e) => {
                e.stopPropagation()
                begin()
                updateShape(shape.id, { hidden: !shape.hidden })
              }}
            >
              <Icon name={shape.hidden ? 'eyeOff' : 'eye'} size={13} />
            </button>
            <button
              className="layer-btn"
              title={shape.locked ? 'Unlock' : 'Lock'}
              onClick={(e) => {
                e.stopPropagation()
                begin()
                updateShape(shape.id, { locked: !shape.locked })
              }}
            >
              <Icon name="lock" size={13} style={{ opacity: shape.locked ? 1 : 0.4 }} />
            </button>
            <button
              className="layer-btn"
              title="Bring forward"
              onClick={(e) => {
                e.stopPropagation()
                reorder(shape.id, 'forward')
              }}
            >
              <Icon name="chevronDown" size={13} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <button
              className="layer-btn"
              title="Send backward"
              onClick={(e) => {
                e.stopPropagation()
                reorder(shape.id, 'backward')
              }}
            >
              <Icon name="chevronDown" size={13} />
            </button>
            <button
              className="layer-btn danger"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation()
                removeShapes([shape.id])
              }}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
