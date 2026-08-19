import React, { useState } from 'react'
import type {
  ArrowShape,
  BoxShape,
  CanvasStyle,
  Shape,
  StepShape,
  TextShape
} from '@shared/types'
import { BEAUTIFY_CANVAS, DEFAULT_CANVAS } from '@shared/defaults'
import { ColorPicker, Segmented, Slider, Toggle } from '../../shared/ui'
import { Icon } from '../../shared/icons'
import { useEditor } from '../store'

type SectionKey = 'style' | 'canvas' | 'info'

const GRADIENTS: Array<{ from: string; to: string; name: string }> = [
  { from: '#6366f1', to: '#ec4899', name: 'Vivid' },
  { from: '#0ea5e9', to: '#22d3ee', name: 'Sky' },
  { from: '#f97316', to: '#facc15', name: 'Sunset' },
  { from: '#10b981', to: '#84cc16', name: 'Lime' },
  { from: '#1e293b', to: '#475569', name: 'Slate' },
  { from: '#7c3aed', to: '#2563eb', name: 'Indigo' }
]

const ASPECTS = ['auto', '1:1', '4:3', '16:9', '3:2', '9:16']

export default function Inspector(): React.ReactElement {
  const doc = useEditor((s) => s.doc)
  const style = useEditor((s) => s.style)
  const setStyle = useEditor((s) => s.setStyle)
  const selected = useEditor((s) => s.selectedIds)
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    style: true,
    canvas: true,
    info: false
  })

  if (!doc) return <aside className="inspector" />

  const selectedShapes = doc.shapes.filter((s) => selected.includes(s.id))
  const one = selectedShapes.length === 1 ? selectedShapes[0] : null

  const toggle = (key: SectionKey) => setOpen((o) => ({ ...o, [key]: !o[key] }))

  return (
    <aside className="inspector">
      <Section
        title={one ? labelFor(one) : 'Tool defaults'}
        icon={one ? 'layers' : 'settings'}
        open={open.style}
        onToggle={() => toggle('style')}
      >
        {selectedShapes.length > 1 ? (
          <MultiSelection shapes={selectedShapes} />
        ) : one ? (
          <ShapeStyle shape={one} />
        ) : (
          <DefaultStyle style={style} setStyle={setStyle} />
        )}
      </Section>

      <Section title="Canvas" icon="sparkles" open={open.canvas} onToggle={() => toggle('canvas')}>
        <CanvasStyleEditor />
      </Section>

      <Section title="Image" icon="info" open={open.info} onToggle={() => toggle('info')}>
        <DocumentInfo />
      </Section>
    </aside>
  )
}

/* ------------------------------------------------------------------ */

function Section(props: {
  title: string
  icon: Parameters<typeof Icon>[0]['name']
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className={`insp-section ${props.open ? 'open' : ''}`}>
      <button className="insp-head" onClick={props.onToggle}>
        <Icon name={props.icon} size={14} />
        <span>{props.title}</span>
        <span className="spacer" />
        <Icon name={props.open ? 'chevronDown' : 'chevronRight'} size={14} />
      </button>
      {props.open && <div className="insp-body">{props.children}</div>}
    </section>
  )
}

function Row(props: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="insp-row">
      <span className="insp-label">{props.label}</span>
      <div className="insp-control">{props.children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Defaults (nothing selected)
 * ------------------------------------------------------------------ */

function DefaultStyle({
  style,
  setStyle
}: {
  style: ReturnType<typeof useEditor.getState>['style']
  setStyle: (patch: Partial<ReturnType<typeof useEditor.getState>['style']>) => void
}): React.ReactElement {
  const tool = useEditor((s) => s.tool)

  return (
    <>
      <Row label="Colour">
        <ColorPicker value={style.color} onChange={(color) => setStyle({ color, fill: color })} />
      </Row>
      <Slider
        label="Stroke"
        value={style.strokeWidth}
        min={1}
        max={24}
        suffix="px"
        onChange={(strokeWidth) => setStyle({ strokeWidth })}
      />
      <Slider
        label="Text size"
        value={style.fontSize}
        min={10}
        max={120}
        suffix="px"
        onChange={(fontSize) => setStyle({ fontSize })}
      />
      {(tool === 'blur' || tool === 'pixelate') && (
        <Slider
          label={tool === 'blur' ? 'Blur amount' : 'Pixel size'}
          value={style.intensity}
          min={2}
          max={60}
          onChange={(intensity) => setStyle({ intensity })}
        />
      )}
      {tool === 'step' && (
        <Row label="Shape">
          <Segmented
            value={style.stepShape}
            options={[
              { value: 'circle', label: 'Circle' },
              { value: 'square', label: 'Square' },
              { value: 'diamond', label: 'Diamond' }
            ]}
            onChange={(stepShape) => setStyle({ stepShape })}
          />
        </Row>
      )}
      <div className="divider" />
      <Toggle
        label="Fill shapes"
        checked={style.fillEnabled}
        onChange={(fillEnabled) => setStyle({ fillEnabled })}
      />
      <Toggle label="Dashed" checked={style.dashed} onChange={(dashed) => setStyle({ dashed })} />
      <Toggle label="Drop shadow" checked={style.shadow} onChange={(shadow) => setStyle({ shadow })} />
      <p className="tiny muted" style={{ margin: '8px 0 0' }}>
        These apply to the next shape you draw. Select an existing shape to restyle it.
      </p>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Selected shape
 * ------------------------------------------------------------------ */

function labelFor(shape: Shape): string {
  const names: Record<string, string> = {
    arrow: 'Arrow',
    line: 'Line',
    measure: 'Measurement',
    pen: 'Pen stroke',
    highlighter: 'Highlight',
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    text: 'Text',
    callout: 'Callout',
    step: 'Step number',
    blur: 'Blur',
    pixelate: 'Pixelate',
    redact: 'Redaction',
    spotlight: 'Spotlight',
    magnify: 'Magnifier'
  }
  return names[shape.type] ?? 'Shape'
}

function ShapeStyle({ shape }: { shape: Shape }): React.ReactElement {
  const { updateShape, begin, end, removeShapes, reorder } = useEditor.getState()

  const patch = (p: Partial<Shape>, history = true) => {
    if (history) begin()
    updateShape(shape.id, p)
    if (history) end()
  }

  const hasStroke = 'stroke' in shape && shape.type !== 'redact' && shape.type !== 'spotlight'
  const isBox = 'width' in shape && 'height' in shape
  const isText = shape.type === 'text' || shape.type === 'callout'

  return (
    <>
      {hasStroke && (
        <Row label={isText ? 'Text' : 'Colour'}>
          <ColorPicker
            value={(shape as { stroke?: string }).stroke ?? '#ff3b30'}
            onChangeStart={begin}
            onChangeEnd={end}
            onChange={(stroke) => patch({ stroke } as Partial<Shape>, false)}
          />
        </Row>
      )}

      {isText && (
        <>
          <Row label="Text">
            <ColorPicker
              value={(shape as TextShape).color}
              onChangeStart={begin}
              onChangeEnd={end}
              onChange={(color) => patch({ color } as Partial<Shape>, false)}
            />
          </Row>
          {shape.type === 'callout' && (
            <Row label="Bubble">
              <ColorPicker
                value={(shape as TextShape).background ?? '#ff3b30'}
                onChangeStart={begin}
                onChangeEnd={end}
                onChange={(background) => patch({ background } as Partial<Shape>, false)}
              />
            </Row>
          )}
          <Slider
            label="Font size"
            value={(shape as TextShape).fontSize}
            min={10}
            max={140}
            suffix="px"
            onChangeStart={begin}
            onChangeEnd={end}
            onChange={(fontSize) => patch({ fontSize } as Partial<Shape>, false)}
          />
          <Row label="Align">
            <Segmented
              value={(shape as TextShape).align ?? 'left'}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Centre' },
                { value: 'right', label: 'Right' }
              ]}
              onChange={(align) => patch({ align } as Partial<Shape>)}
            />
          </Row>
          <Row label="Weight">
            <Segmented
              value={((shape as TextShape).fontStyle ?? 'normal') as string}
              options={[
                { value: 'normal', label: 'Regular' },
                { value: '600', label: 'Semibold' },
                { value: 'italic', label: 'Italic' }
              ]}
              onChange={(fontStyle) => patch({ fontStyle } as Partial<Shape>)}
            />
          </Row>
        </>
      )}

      {'strokeWidth' in shape && shape.type !== 'redact' && !isText && (
        <Slider
          label="Stroke"
          value={(shape as { strokeWidth: number }).strokeWidth}
          min={1}
          max={40}
          suffix="px"
          onChangeStart={begin}
          onChangeEnd={end}
          onChange={(strokeWidth) => patch({ strokeWidth } as Partial<Shape>, false)}
        />
      )}

      {(shape.type === 'rect' || shape.type === 'ellipse') && (
        <>
          <Toggle
            label="Filled"
            checked={Boolean((shape as BoxShape).fill)}
            onChange={(on) =>
              patch({ fill: on ? (shape as BoxShape).stroke : undefined } as Partial<Shape>)
            }
          />
          {shape.type === 'rect' && (
            <Slider
              label="Corner radius"
              value={(shape as BoxShape).cornerRadius ?? 0}
              min={0}
              max={80}
              onChangeStart={begin}
              onChangeEnd={end}
              onChange={(cornerRadius) => patch({ cornerRadius } as Partial<Shape>, false)}
            />
          )}
        </>
      )}

      {(shape.type === 'blur' || shape.type === 'pixelate') && (
        <Slider
          label={shape.type === 'blur' ? 'Blur amount' : 'Pixel size'}
          value={(shape as BoxShape).intensity ?? 12}
          min={2}
          max={60}
          onChangeStart={begin}
          onChangeEnd={end}
          onChange={(intensity) => patch({ intensity } as Partial<Shape>, false)}
        />
      )}

      {shape.type === 'magnify' && (
        <Slider
          label="Magnification"
          value={(shape as BoxShape).intensity ?? 2}
          min={1.2}
          max={6}
          step={0.1}
          suffix="×"
          onChangeStart={begin}
          onChangeEnd={end}
          onChange={(intensity) => patch({ intensity } as Partial<Shape>, false)}
        />
      )}

      {shape.type === 'spotlight' && (
        <Slider
          label="Dim outside"
          value={((shape as BoxShape).dim ?? 0.62) * 100}
          min={10}
          max={95}
          suffix="%"
          onChangeStart={begin}
          onChangeEnd={end}
          onChange={(v) => patch({ dim: v / 100 } as Partial<Shape>, false)}
        />
      )}

      {shape.type === 'step' && (
        <>
          <Row label="Number">
            <input
              className="field"
              type="number"
              min={0}
              value={(shape as StepShape).index}
              onFocus={begin}
              onBlur={end}
              onChange={(e) => patch({ index: Number(e.target.value) } as Partial<Shape>, false)}
            />
          </Row>
          <Row label="Shape">
            <Segmented
              value={(shape as StepShape).shape ?? 'circle'}
              options={[
                { value: 'circle', label: 'Circle' },
                { value: 'square', label: 'Square' },
                { value: 'diamond', label: 'Diamond' }
              ]}
              onChange={(v) => patch({ shape: v } as Partial<Shape>)}
            />
          </Row>
          <Slider
            label="Size"
            value={(shape as StepShape).radius}
            min={10}
            max={90}
            onChangeStart={begin}
            onChangeEnd={end}
            onChange={(radius) =>
              patch({ radius, fontSize: Math.round(radius * 1.1) } as Partial<Shape>, false)
            }
          />
          <Row label="Fill">
            <ColorPicker
              value={(shape as StepShape).fill}
              onChangeStart={begin}
              onChangeEnd={end}
              onChange={(fill) => patch({ fill } as Partial<Shape>, false)}
            />
          </Row>
        </>
      )}

      {(shape.type === 'arrow' || shape.type === 'measure') && (
        <>
          <Slider
            label="Curve"
            value={(shape as ArrowShape).curve ?? 0}
            min={-160}
            max={160}
            onChangeStart={begin}
            onChangeEnd={end}
            onChange={(curve) => patch({ curve } as Partial<Shape>, false)}
          />
          <Toggle
            label="Head at start"
            checked={Boolean((shape as ArrowShape).startHead)}
            onChange={(startHead) => patch({ startHead } as Partial<Shape>)}
          />
          <Toggle
            label="Head at end"
            checked={(shape as ArrowShape).endHead !== false}
            onChange={(endHead) => patch({ endHead } as Partial<Shape>)}
          />
        </>
      )}

      {'dash' in shape && (
        <Toggle
          label="Dashed"
          checked={Boolean((shape as { dash?: number[] }).dash)}
          onChange={(on) =>
            patch({
              dash: on
                ? [(shape as { strokeWidth: number }).strokeWidth * 3, (shape as { strokeWidth: number }).strokeWidth * 2]
                : undefined
            } as Partial<Shape>)
          }
        />
      )}

      {'shadow' in shape && (
        <Toggle
          label="Drop shadow"
          checked={Boolean((shape as { shadow?: boolean }).shadow)}
          onChange={(shadow) => patch({ shadow } as Partial<Shape>)}
        />
      )}

      <Slider
        label="Opacity"
        value={(shape.opacity ?? 1) * 100}
        min={5}
        max={100}
        suffix="%"
        onChangeStart={begin}
        onChangeEnd={end}
        onChange={(v) => patch({ opacity: v / 100 } as Partial<Shape>, false)}
      />

      {isBox && (
        <div className="insp-dims mono tiny">
          {Math.round(Math.abs((shape as BoxShape).width))} ×{' '}
          {Math.round(Math.abs((shape as BoxShape).height))} px
        </div>
      )}

      <Row label="Rotation">
        <div className="row" style={{ width: '100%', gap: 6 }}>
          <input
            className="field"
            style={{ flex: '0 0 82px', width: 82 }}
            type="number"
            min={-360}
            max={360}
            step={1}
            inputMode="decimal"
            aria-label="Rotation"
            value={Math.round((shape.rotation ?? 0) * 10) / 10}
            onFocus={begin}
            onBlur={end}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (!Number.isFinite(value)) return
              patch({ rotation: Math.max(-360, Math.min(360, value)) }, false)
            }}
          />
          <span className="tiny muted">°</span>
          <button
            className="btn sm ghost"
            type="button"
            disabled={!shape.rotation}
            onClick={() => patch({ rotation: 0 })}
          >
            Reset
          </button>
        </div>
      </Row>

      <div className="divider" />

      <div className="row" style={{ gap: 4 }}>
        <button className="btn sm ghost tip" data-tip="Bring to front" aria-label="Bring to front" onClick={() => reorder(shape.id, 'front')}>
          <Icon name="chevronDown" size={13} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button className="btn sm ghost tip" data-tip="Send to back" aria-label="Send to back" onClick={() => reorder(shape.id, 'back')}>
          <Icon name="chevronDown" size={13} />
        </button>
        <button
          className="btn sm ghost"
          onClick={() => {
            begin()
            updateShape(shape.id, { locked: !shape.locked })
          }}
        >
          <Icon name={shape.locked ? 'lock' : 'eye'} size={13} />
          {shape.locked ? 'Locked' : 'Lock'}
        </button>
        <span className="spacer" />
        <button className="btn sm danger" aria-label="Delete annotation" onClick={() => removeShapes([shape.id])}>
          <Icon name="trash" size={13} />
        </button>
      </div>
    </>
  )
}

function MultiSelection({ shapes }: { shapes: Shape[] }): React.ReactElement {
  const { begin, end, updateShapes, removeShapes } = useEditor.getState()

  const applyColour = (color: string) => {
    const patch: Record<string, Partial<Shape>> = {}
    for (const s of shapes) {
      patch[s.id] =
        s.type === 'text' || s.type === 'callout'
          ? ({ color } as Partial<Shape>)
          : s.type === 'step'
            ? ({ fill: color } as Partial<Shape>)
            : ({ stroke: color } as Partial<Shape>)
    }
    updateShapes(patch)
  }

  return (
    <>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        {shapes.length} shapes selected
      </p>
      <Row label="Colour">
        <ColorPicker
          value="#ff3b30"
          onChangeStart={begin}
          onChangeEnd={end}
          onChange={applyColour}
        />
      </Row>
      <div className="divider" />
      <button className="btn sm danger" onClick={() => removeShapes(shapes.map((s) => s.id))}>
        <Icon name="trash" size={13} /> Delete all
      </button>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Canvas / beautify
 * ------------------------------------------------------------------ */

function CanvasStyleEditor(): React.ReactElement {
  const doc = useEditor((s) => s.doc)!
  const setCanvas = useEditor((s) => s.setCanvas)
  const begin = useEditor((s) => s.begin)
  const end = useEditor((s) => s.end)
  const c = doc.canvas
  const changeCanvas = (patch: Partial<CanvasStyle>) => {
    begin()
    setCanvas(patch)
    end()
  }

  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn sm primary"
          onClick={() => changeCanvas(BEAUTIFY_CANVAS)}
        >
          <Icon name="sparkles" size={13} /> Beautify
        </button>
        <button
          className="btn sm ghost"
          onClick={() => changeCanvas(DEFAULT_CANVAS)}
        >
          Reset
        </button>
      </div>

      <div className="divider" />

      <Slider
        label="Padding"
        value={c.padding}
        min={0}
        max={220}
        suffix="px"
        onChangeStart={begin}
        onChangeEnd={end}
        onChange={(padding) => setCanvas({ padding })}
      />

      <Row label="Background">
        <Segmented
          value={c.background}
          options={[
            { value: 'none', label: 'None' },
            { value: 'solid', label: 'Solid' },
            { value: 'gradient', label: 'Gradient' }
          ]}
          onChange={(background) => changeCanvas({ background })}
        />
      </Row>

      {c.background === 'solid' && (
        <Row label="Colour">
          <ColorPicker
            value={c.backgroundColor}
            onChangeStart={begin}
            onChangeEnd={end}
            onChange={(backgroundColor) => setCanvas({ backgroundColor })}
            swatches={['#0b0f14', '#111827', '#1f2937', '#f8fafc', '#e2e8f0', '#ffffff']}
          />
        </Row>
      )}

      {c.background === 'gradient' && (
        <>
          <div className="grad-grid">
            {GRADIENTS.map((g) => (
              <button
                key={g.name}
                title={g.name}
                className="grad-swatch"
                style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}
                onClick={() => changeCanvas({ gradientFrom: g.from, gradientTo: g.to })}
              />
            ))}
          </div>
          <Slider
            label="Angle"
            value={c.gradientAngle}
            min={0}
            max={360}
            suffix="°"
            onChangeStart={begin}
            onChangeEnd={end}
            onChange={(gradientAngle) => setCanvas({ gradientAngle })}
          />
        </>
      )}

      <Slider
        label="Corner radius"
        value={c.radius}
        min={0}
        max={64}
        onChangeStart={begin}
        onChangeEnd={end}
        onChange={(radius) => setCanvas({ radius })}
      />
      <Slider
        label="Shadow"
        value={c.shadowBlur}
        min={0}
        max={160}
        onChangeStart={begin}
        onChangeEnd={end}
        onChange={(shadowBlur) => setCanvas({ shadowBlur })}
      />
      {c.shadowBlur > 0 && (
        <Slider
          label="Shadow strength"
          value={c.shadowOpacity * 100}
          min={5}
          max={100}
          suffix="%"
          onChangeStart={begin}
          onChangeEnd={end}
          onChange={(v) => setCanvas({ shadowOpacity: v / 100 })}
        />
      )}
      <Slider
        label="Border"
        value={c.borderWidth}
        min={0}
        max={12}
        suffix="px"
        onChangeStart={begin}
        onChangeEnd={end}
        onChange={(borderWidth) => setCanvas({ borderWidth })}
      />

      <div className="divider" />

      <Row label="Window frame">
        <Segmented
          value={c.frame}
          options={[
            { value: 'none', label: 'None' },
            { value: 'macos', label: 'macOS' },
            { value: 'windows', label: 'Windows' }
          ]}
          onChange={(frame) => changeCanvas({ frame })}
        />
      </Row>
      {c.frame !== 'none' && (
        <Row label="Title">
          <input
            className="field"
            value={c.frameTitle ?? ''}
            placeholder="Optional window title"
            onFocus={begin}
            onBlur={end}
            onChange={(e) => setCanvas({ frameTitle: e.target.value })}
          />
        </Row>
      )}

      <Row label="Aspect">
        <select
          className="field"
          value={c.aspect ?? 'auto'}
          onChange={(e) => changeCanvas({ aspect: e.target.value })}
        >
          {ASPECTS.map((a) => (
            <option key={a} value={a}>
              {a === 'auto' ? 'Original' : a}
            </option>
          ))}
        </select>
      </Row>

      <Slider
        label="Tilt horizontal"
        value={c.tiltSemantics === 'visible-axis' ? c.tiltX : c.tiltY}
        min={-24}
        max={24}
        suffix="°"
        onChangeStart={begin}
        onChangeEnd={end}
        onChange={(value) =>
          setCanvas(c.tiltSemantics === 'visible-axis' ? { tiltX: value } : { tiltY: value })
        }
      />
      <Slider
        label="Tilt vertical"
        value={c.tiltSemantics === 'visible-axis' ? c.tiltY : c.tiltX}
        min={-24}
        max={24}
        suffix="°"
        onChangeStart={begin}
        onChangeEnd={end}
        onChange={(value) =>
          setCanvas(c.tiltSemantics === 'visible-axis' ? { tiltY: value } : { tiltX: value })
        }
      />
    </>
  )
}

function DocumentInfo(): React.ReactElement {
  const doc = useEditor((s) => s.doc)!
  const setTitle = useEditor((s) => s.setTitle)
  const begin = useEditor((s) => s.begin)
  const end = useEditor((s) => s.end)
  const resetCrop = useEditor((s) => s.resetCrop)
  const size = useEditor((s) => s.contentSize)()

  return (
    <>
      <Row label="Name">
        <input
          className="field"
          value={doc.title}
          onFocus={begin}
          onBlur={end}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Row>
      <div className="insp-facts tiny mono">
        <div>
          <span className="muted">Size</span> {size.width} × {size.height}
        </div>
        <div>
          <span className="muted">Source</span> {doc.imageWidth} × {doc.imageHeight}
        </div>
        <div>
          <span className="muted">Shapes</span> {doc.shapes.length}
        </div>
        <div>
          <span className="muted">Created</span> {new Date(doc.createdAt).toLocaleString()}
        </div>
      </div>
      {doc.crop.enabled && (
        <button className="btn sm ghost" onClick={resetCrop}>
          <Icon name="refresh" size={13} /> Undo crop
        </button>
      )}
      {doc.ocrText && (
        <>
          <div className="divider" />
          <div className="label">Extracted text</div>
          <textarea className="field" rows={6} readOnly value={doc.ocrText} />
        </>
      )}
    </>
  )
}
