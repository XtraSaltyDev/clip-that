import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Path,
  Rect,
  Stage,
  Text as KonvaText,
  Transformer
} from 'react-konva'
import type { CanvasStyle, ClipDocument, CutOutOperation, Shape, TextShape, ToolId } from '@shared/types'
import {
  BOX_TOOLS,
  CLICK_TOOLS,
  FREEHAND_TOOLS,
  LINE_TOOLS,
  TEXT_TOOLS,
  createShape,
  isTextShape,
  useEditor
} from '../store'
import { cutOutEdgeAmplitude, cutOutEdgePath, CUT_OUT_MIN_SIZE } from '@shared/cut-out'
import { ShapeNode, type ShapeContext } from './Shapes'
import { shapeTransformPatch } from './transforms'
import { canvasTiltTransform } from './tilt'
import { computeLayout, fitScale, type Layout } from '../layout'
import { Icon } from '../../shared/icons'
import LiveText from './LiveText'

interface Props {
  image: HTMLImageElement
  containerWidth: number
  containerHeight: number
  stageRef: React.MutableRefObject<Konva.Stage | null>
}

/** Snap threshold in image pixels, scaled so it feels constant on screen. */
const SNAP_PX = 6

/** Keep the rotation handle below the selection so the floating toolbar cannot cover it. */
const ROTATE_ANCHOR_GAP = 25
const ROTATE_ICON_SIZE = 20

export default function EditorStage({
  image,
  containerWidth,
  containerHeight,
  stageRef
}: Props): React.ReactElement | null {
  const doc = useEditor((s) => s.doc)
  const tool = useEditor((s) => s.tool)
  const zoom = useEditor((s) => s.zoom)
  const autoFit = useEditor((s) => s.autoFit)
  const selectedIds = useEditor((s) => s.selectedIds)
  const editingTextId = useEditor((s) => s.editingTextId)
  const cropDraft = useEditor((s) => s.cropDraft)
  const cutOutDraft = useEditor((s) => s.cutOutDraft)
  const cutOutAxis = useEditor((s) => s.cutOutAxis)
  const cutOutEdge = useEditor((s) => s.cutOutEdge)
  const liveText = useEditor((s) => s.liveTextOn)

  const {
    addShape,
    updateShape,
    select,
    setEditingText,
    setZoom,
    begin,
    setCropDraft,
    setCutOutDraft
  } =
    useEditor.getState()

  const shapesGroupRef = useRef<Konva.Group>(null)
  const artLayerRef = useRef<Konva.Layer>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const rotateIconGroupRef = useRef<Konva.Group>(null)
  const rotateSyncFrame = useRef<number | null>(null)
  const drafting = useRef<{ id: string; origin: { x: number; y: number } } | null>(null)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const [guides, setGuides] = useState<Array<{ x?: number; y?: number }>>([])
  const [textBox, setTextBox] = useState<{ left: number; top: number; width: number } | null>(null)
  const [selBox, setSelBox] = useState<{ left: number; top: number; width: number } | null>(null)

  /**
   * Layout only depends on geometry, never on the shape list — keying the memo on those
   * fields is what keeps the (expensive) base layer from re-rendering while you annotate.
   */
  const layout = useMemo(
    () => (doc ? computeLayout(doc) : null),
    [doc?.crop, doc?.canvas, doc?.cutOuts, doc?.imageWidth, doc?.imageHeight]
  )

  /* ---------- auto-fit ---------- */

  useLayoutEffect(() => {
    if (!layout || !autoFit || containerWidth === 0 || containerHeight === 0) return
    const scale = fitScale(layout, containerWidth, containerHeight)
    if (Math.abs(zoom - scale) < 0.0001) return
    setZoom(scale, true)
  }, [layout, autoFit, containerWidth, containerHeight, setZoom, zoom])

  /* ---------- transformer ---------- */

  const syncRotateIcon = useCallback(() => {
    const icon = rotateIconGroupRef.current
    const transformer = transformerRef.current
    const anchor = transformer?.findOne('.rotater')
    if (!icon) return

    if (!transformer || transformer.nodes().length === 0 || !anchor || !anchor.visible()) {
      icon.visible(false)
      return
    }

    // The icon is a listening=false sibling of the Transformer. Positioning it from the
    // actual rotater anchor keeps the visual glyph aligned while the transparent anchor
    // underneath remains the drag target.
    icon.absolutePosition(anchor.getAbsolutePosition())
    icon.rotation(0)
    icon.visible(true)
  }, [])

  const syncRotateAnchor = useCallback(() => {
    const transformer = transformerRef.current
    if (!transformer || transformer.nodes().length === 0) {
      syncRotateIcon()
      return
    }

    // Konva's rotateAnchorOffset is measured from the top edge. Use the current
    // selection height to place the handle the same distance below the bottom edge.
    const height = transformer.height()
    const direction = height < 0 ? -1 : 1
    const targetY = height < 0 ? ROTATE_ANCHOR_GAP : height + ROTATE_ANCHOR_GAP
    const offset = -(targetY + transformer.padding()) * direction
    if (Math.abs(transformer.rotateAnchorOffset() - offset) >= 0.5) {
      transformer.rotateAnchorOffset(offset)
    }
    syncRotateIcon()
    transformer.getLayer()?.batchDraw()
  }, [syncRotateIcon])

  const scheduleRotateAnchorSync = useCallback(() => {
    if (rotateSyncFrame.current !== null) return
    rotateSyncFrame.current = window.requestAnimationFrame(() => {
      rotateSyncFrame.current = null
      syncRotateAnchor()
    })
  }, [syncRotateAnchor])

  const styleTransformerAnchor = useCallback((anchor: Konva.Rect) => {
    if (!anchor.hasName('rotater')) return

    // Keep a larger, transparent drag target. The visible glyph is a separate Konva group
    // so it cannot be clipped by a fill pattern or intercept the anchor's drag events.
    anchor.size({ width: ROTATE_ICON_SIZE, height: ROTATE_ICON_SIZE })
    anchor.offset({ x: ROTATE_ICON_SIZE / 2, y: ROTATE_ICON_SIZE / 2 })
    anchor.stroke('transparent')
    anchor.strokeWidth(0)
    anchor.fillPriority('color')
    anchor.fill('transparent')
  }, [])

  useLayoutEffect(() => {
    const tr = transformerRef.current
    const layer = artLayerRef.current
    if (!tr || !layer) return
    if (tool !== 'select' || selectedIds.length === 0) {
      tr.nodes([])
      rotateIconGroupRef.current?.visible(false)
      layer.batchDraw()
      return
    }
    const nodes = selectedIds
      .map((id) => layer.findOne(`#${id}`))
      .filter((n): n is Konva.Node => Boolean(n))
    tr.nodes(nodes)
    syncRotateAnchor()
    layer.batchDraw()
  }, [selectedIds, tool, doc?.shapes, syncRotateAnchor])

  /* ---------- pointer → image coordinates ---------- */

  const pointer = useCallback((): { x: number; y: number } | null => {
    const group = shapesGroupRef.current
    if (!group) return null
    const p = group.getRelativePointerPosition()
    return p ? { x: p.x, y: p.y } : null
  }, [])

  /** Cut Out drafts are always expressed from the top-left of the currently visible image. */
  const cutOutPointer = useCallback(
    (p: { x: number; y: number }): { x: number; y: number } =>
      doc?.cutOuts?.length ? p : { x: p.x - (layout?.cropX ?? 0), y: p.y - (layout?.cropY ?? 0) },
    [doc?.cutOuts, layout?.cropX, layout?.cropY]
  )

  const cutOutSource = useCallback((): CutOutOperation['source'] | null => {
    if (!doc || !layout) return null
    return doc.cutOuts?.length
      ? { x: 0, y: 0, width: layout.contentWidth, height: layout.contentHeight }
      : { x: layout.cropX, y: layout.cropY, width: layout.contentWidth, height: layout.contentHeight }
  }, [doc, layout])

  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return
    const p = pointer()
    if (!p || !doc) return

    if (tool === 'select') {
      if (e.target === e.target.getStage() || e.target.name() === 'backdrop') select([])
      return
    }

    if (tool === 'crop') {
      setCropDraft({ enabled: false, x: p.x, y: p.y, width: 0, height: 0 })
      drafting.current = { id: 'crop', origin: p }
      return
    }

    if (tool === 'cutOut') {
      const source = cutOutSource()
      if (!source) return
      const local = cutOutPointer(p)
      const axisValue = cutOutAxis === 'horizontal' ? local.y : local.x
      const max = cutOutAxis === 'horizontal' ? source.height : source.width
      const low = Math.min(CUT_OUT_MIN_SIZE, max / 3)
      const high = Math.max(low, max - low)
      setCutOutDraft({
        source,
        axis: cutOutAxis,
        edge: cutOutEdge,
        start: Math.max(low, Math.min(high, axisValue)),
        size: 0
      })
      drafting.current = { id: 'cutOut', origin: local }
      return
    }

    const z = doc.shapes.reduce((m, s) => Math.max(m, s.z), 0) + 1
    const shape = createShape(tool, p, useEditor.getState().style, z, useEditor.getState().nextStepIndex())
    if (!shape) return

    if (CLICK_TOOLS.includes(tool)) {
      addShape(shape)
      // Step is intentionally repeatable: keep placing the next number until the
      // user presses Escape or chooses another tool. Other click tools remain one-shot.
      if (tool !== 'step') useEditor.getState().setTool('select')
      return
    }
    if (TEXT_TOOLS.includes(tool)) {
      addShape(shape)
      setEditingText(shape.id)
      useEditor.getState().setTool('select')
      return
    }

    addShape(shape)
    drafting.current = { id: shape.id, origin: p }
    lastPoint.current = p
  }

  const onStageMouseMove = () => {
    const draft = drafting.current
    if (!draft) return
    const p = pointer()
    if (!p) return

    if (draft.id === 'crop') {
      setCropDraft({
        enabled: false,
        x: Math.min(draft.origin.x, p.x),
        y: Math.min(draft.origin.y, p.y),
        width: Math.abs(p.x - draft.origin.x),
        height: Math.abs(p.y - draft.origin.y)
      })
      return
    }

    if (draft.id === 'cutOut') {
      const current = useEditor.getState().cutOutDraft
      if (!current) return
      const local = cutOutPointer(p)
      const axisValue = current.axis === 'horizontal' ? local.y : local.x
      const originValue = current.axis === 'horizontal' ? draft.origin.y : draft.origin.x
      const max = current.axis === 'horizontal' ? current.source.height : current.source.width
      const low = Math.min(CUT_OUT_MIN_SIZE, max / 3)
      const high = Math.max(low, max - low)
      const start = Math.max(low, Math.min(high, Math.min(originValue, axisValue)))
      const end = Math.max(low, Math.min(high, Math.max(originValue, axisValue)))
      setCutOutDraft({ ...current, start, size: end - start })
      return
    }

    const shape = useEditor.getState().doc?.shapes.find((s) => s.id === draft.id)
    if (!shape) return

    if (FREEHAND_TOOLS.includes(shape.type)) {
      // Sampling every mousemove produces hundreds of near-identical points, which makes
      // the stroke heavy to render and to store. One point per ~3 screen pixels is plenty.
      const last = lastPoint.current
      const minGap = 3 / Math.max(zoom, 0.05)
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < minGap) return
      lastPoint.current = p
      updateShape(draft.id, {
        points: [...(shape as { points: number[] }).points, p.x, p.y]
      } as Partial<Shape>)
      return
    }
    if (LINE_TOOLS.includes(shape.type)) {
      updateShape(draft.id, { points: [draft.origin.x, draft.origin.y, p.x, p.y] } as Partial<Shape>)
      return
    }
    if (BOX_TOOLS.includes(shape.type)) {
      updateShape(draft.id, {
        x: Math.min(draft.origin.x, p.x),
        y: Math.min(draft.origin.y, p.y),
        width: Math.abs(p.x - draft.origin.x),
        height: Math.abs(p.y - draft.origin.y)
      } as Partial<Shape>)
    }
  }

  const onStageMouseUp = () => {
    const draft = drafting.current
    drafting.current = null
    lastPoint.current = null
    if (!draft || draft.id === 'crop' || draft.id === 'cutOut') return

    const shape = useEditor.getState().doc?.shapes.find((s) => s.id === draft.id)
    if (!shape) return

    const tiny =
      BOX_TOOLS.includes(shape.type) &&
      Math.abs((shape as { width: number }).width) < 4 &&
      Math.abs((shape as { height: number }).height) < 4
    const stub =
      LINE_TOOLS.includes(shape.type) &&
      Math.hypot(
        (shape as { points: number[] }).points[2] - (shape as { points: number[] }).points[0],
        (shape as { points: number[] }).points[3] - (shape as { points: number[] }).points[1]
      ) < 6

    if (tiny || stub) {
      useEditor.getState().removeShapes([shape.id])
      // addShape and removeShapes each pushed history; drop both so undo isn't a no-op.
      useEditor.setState((s) => ({ past: s.past.slice(0, -2) }))
      return
    }

    select([shape.id])
    useEditor.getState().setTool('select')
  }

  /* ---------- alignment guides while dragging ---------- */

  const onDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target
      const state = useEditor.getState()
      const current = state.doc
      if (!current || node === shapesGroupRef.current) return

      const box = node.getClientRect({ relativeTo: shapesGroupRef.current ?? undefined })
      const threshold = SNAP_PX / Math.max(zoom, 0.05)

      const layoutNow = layout
      if (!layoutNow) return
      const contentCenterX = layoutNow.cropX + layoutNow.contentWidth / 2
      const contentCenterY = layoutNow.cropY + layoutNow.contentHeight / 2

      // Candidate lines: the canvas centre plus every other shape's edges and centre.
      const vLines: number[] = [contentCenterX]
      const hLines: number[] = [contentCenterY]
      for (const other of current.shapes) {
        if (other.id === node.id() || !('x' in other)) continue
        const ow = 'width' in other ? Math.abs(other.width) : 0
        const oh = 'height' in other ? Math.abs(other.height ?? 0) : 0
        vLines.push(other.x, other.x + ow / 2, other.x + ow)
        hLines.push(other.y, other.y + oh / 2, other.y + oh)
      }

      const found: Array<{ x?: number; y?: number }> = []
      const near = (a: number, b: number) => Math.abs(a - b) < threshold

      for (const line of vLines) {
        for (const [edge, offset] of [
          [box.x, 0],
          [box.x + box.width / 2, box.width / 2],
          [box.x + box.width, box.width]
        ] as Array<[number, number]>) {
          if (near(edge, line)) {
            node.x(node.x() + (line - edge))
            found.push({ x: line })
            break
          }
          void offset
        }
        if (found.some((f) => f.x !== undefined)) break
      }
      for (const line of hLines) {
        for (const edge of [box.y, box.y + box.height / 2, box.y + box.height]) {
          if (near(edge, line)) {
            node.y(node.y() + (line - edge))
            found.push({ y: line })
            break
          }
        }
        if (found.some((f) => f.y !== undefined)) break
      }

      setGuides(found)
    },
    [layout, zoom]
  )

  const onDragEnd = useCallback(() => setGuides([]), [])

  /**
   * Shape nodes are memoised, so their handlers must be referentially stable —
   * read the live selection from the store rather than closing over it.
   */
  const onSelectShape = useCallback((id: string, additive: boolean) => {
    const current = useEditor.getState().selectedIds
    useEditor.getState().select(
      additive
        ? current.includes(id)
          ? current.filter((s) => s !== id)
          : [...current, id]
        : [id]
    )
  }, [])

  const commitShapeChange = useCallback((id: string, patch: Partial<Shape>) => {
    const state = useEditor.getState()
    state.updateShape(id, patch)
    state.end()
  }, [])

  const commitTransform = useCallback(() => {
    const transformer = transformerRef.current
    const state = useEditor.getState()
    const current = state.doc
    if (!transformer || !current) return

    for (const node of transformer.nodes()) {
      const shape = current.shapes.find((candidate) => candidate.id === node.id())
      if (!shape) continue
      const patch = shapeTransformPatch(shape, node)
      state.updateShape(shape.id, patch)

      // Point-based nodes keep their geometry in the document, so clear Konva's transient
      // translation as well as its scale. Measurement groups keep their midpoint as origin.
      if ('points' in shape && shape.type !== 'measure') {
        node.position({ x: 0, y: 0 })
      } else if (shape.type === 'measure' && 'points' in patch) {
        const points = patch.points as number[]
        node.position({ x: (points[0] + points[2]) / 2, y: (points[1] + points[3]) / 2 })
      }
      node.scaleX(1)
      node.scaleY(1)
    }
    // Always close the transaction, including rotation-only and multi-selection transforms.
    state.end()
    transformer.getLayer()?.batchDraw()
  }, [])

  /* ---------- floating toolbar position ---------- */

  useEffect(() => {
    const layer = artLayerRef.current
    if (!layer || tool !== 'select' || selectedIds.length === 0 || editingTextId) {
      setSelBox(null)
      return
    }
    const nodes = selectedIds
      .map((id) => layer.findOne(`#${id}`))
      .filter((n): n is Konva.Node => Boolean(n))
    if (nodes.length === 0) {
      setSelBox(null)
      return
    }
    // getClientRect is already in stage pixels, which are the container's CSS pixels.
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    for (const node of nodes) {
      const r = node.getClientRect()
      left = Math.min(left, r.x)
      top = Math.min(top, r.y)
      right = Math.max(right, r.x + r.width)
    }
    setSelBox({ left, top, width: right - left })
  }, [selectedIds, doc?.shapes, zoom, tool, editingTextId, guides])

  /* ---------- text editing overlay ---------- */

  useEffect(() => {
    if (!editingTextId) {
      setTextBox(null)
      return
    }
    const node = artLayerRef.current?.findOne(`#${editingTextId}`)
    if (!node) return
    const abs = node.getAbsolutePosition()
    const shape = doc?.shapes.find((s) => s.id === editingTextId)
    setTextBox({
      left: abs.x,
      top: abs.y,
      width: shape && isTextShape(shape) ? shape.width * zoom : 240
    })
  }, [editingTextId, doc?.shapes, zoom])

  if (!doc || !layout) return null

  const shapeCtx: ShapeContext = {
    image,
    cropX: doc.cutOuts?.length ? 0 : layout.cropX,
    cropY: doc.cutOuts?.length ? 0 : layout.cropY,
    cropW: layout.contentWidth,
    cropH: layout.contentHeight,
    zoom
  }

  const editingShape = doc.shapes.find((s) => s.id === editingTextId)
  const sorted = [...doc.shapes].sort((a, b) => a.z - b.z)
  const shapeOrigin = doc.cutOuts?.length ? 0 : -layout.cropX

  return (
    <div style={{ position: 'relative' }}>
      <Stage
        ref={(node) => {
          stageRef.current = node
        }}
        width={layout.canvasWidth * zoom}
        height={layout.canvasHeight * zoom}
        scaleX={zoom}
        scaleY={zoom}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
        onMouseLeave={onStageMouseUp}
        style={{
          cursor:
            tool === 'select'
              ? 'default'
              : tool === 'text' || tool === 'callout'
                ? 'text'
                : 'crosshair'
        }}
      >
        <BaseLayer image={image} layout={layout} canvas={doc.canvas} />

        <Layer ref={artLayerRef}>
          <ShotFrame layout={layout} canvas={doc.canvas} clip>
            <Group
              ref={shapesGroupRef}
              x={shapeOrigin}
              y={-layout.cropY}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
            >
              {sorted.map((shape) => (
                <ShapeNode
                  key={shape.id}
                  shape={shape}
                  ctx={shapeCtx}
                  draggable={tool === 'select'}
                  onSelect={onSelectShape}
                  onChange={commitShapeChange}
                  onDragStart={begin}
                  onEditText={setEditingText}
                />
              ))}
            </Group>
          </ShotFrame>

          <Transformer
            ref={transformerRef}
            rotateEnabled
            keepRatio={false}
            ignoreStroke
            // Konva normalises the transformer against the stage scale, so these
            // are screen pixels and must not be divided by zoom.
            anchorSize={9}
            anchorCornerRadius={2}
            borderStroke="#4f8cff"
            borderStrokeWidth={1.5}
            anchorStroke="#4f8cff"
            anchorFill="#ffffff"
            padding={2}
            anchorStyleFunc={styleTransformerAnchor}
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 6 || newBox.height < 6 ? oldBox : newBox
            }
            onTransform={scheduleRotateAnchorSync}
            onTransformStart={begin}
            onTransformEnd={commitTransform}
          />

          <Group
            ref={rotateIconGroupRef}
            listening={false}
            visible={tool === 'select' && selectedIds.length > 0}
          >
            <Circle
              radius={ROTATE_ICON_SIZE / 2}
              fill="#121a29"
              opacity={0.96}
              stroke="#4f8cff"
              strokeWidth={1.2}
            />
            <Path
              data="M 4.9 -1.9 A 5.4 5.4 0 1 0 5 2.7 M 4.9 -5.2 V -1.9 H 1.3"
              stroke="#ffffff"
              strokeWidth={1.7}
              lineCap="round"
              lineJoin="round"
              fillEnabled={false}
            />
          </Group>
        </Layer>

        {liveText && (
          <Layer listening={tool === 'select'}>
            <ShotFrame layout={layout} canvas={doc.canvas} clip>
              <Group x={shapeOrigin} y={-layout.cropY}>
                <LiveText zoom={zoom} />
              </Group>
            </ShotFrame>
          </Layer>
        )}

        <Layer listening={false}>
          {tool === 'crop' && <CropOverlay draft={cropDraft} layout={layout} />}
          {tool === 'cutOut' && <CutOutOverlay draft={cutOutDraft} layout={layout} />}
          {guides.map((g, i) => (
            <Line
              key={i}
              points={
                g.x !== undefined
                  ? [
                      layout.shotX - layout.cropX + g.x,
                      0,
                      layout.shotX - layout.cropX + g.x,
                      layout.canvasHeight
                    ]
                  : [
                      0,
                      layout.shotY + layout.frameHeight - layout.cropY + (g.y ?? 0),
                      layout.canvasWidth,
                      layout.shotY + layout.frameHeight - layout.cropY + (g.y ?? 0)
                    ]
              }
              stroke="#ff2d9b"
              strokeWidth={1 / zoom}
              dash={[4 / zoom, 4 / zoom]}
            />
          ))}
        </Layer>
      </Stage>

      {selBox && <FloatingToolbar box={selBox} />}

      {textBox && editingShape && isTextShape(editingShape) && (
        <textarea
          autoFocus
          className="canvas-text-editor"
          defaultValue={editingShape.text}
          onFocus={() => useEditor.getState().begin()}
          style={{
            left: textBox.left,
            top: textBox.top,
            width: Math.max(120, textBox.width),
            fontSize: editingShape.fontSize * zoom,
            fontFamily: editingShape.fontFamily,
            color: editingShape.color,
            background:
              editingShape.type === 'callout' ? (editingShape.background ?? '#000') : 'transparent',
            padding: (editingShape.padding ?? 4) * zoom
          }}
          onBlur={(e) => {
            updateShape(editingShape.id, { text: e.target.value } as Partial<Shape>)
            useEditor.getState().end()
            setEditingText(null)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Floating selection toolbar
 * ------------------------------------------------------------------ */

const QUICK_COLOURS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#4f8cff', '#af52de', '#ffffff', '#000000']

/**
 * The controls you reach for constantly, put where the cursor already is.
 * Anything deeper stays in the sidebar.
 */
function FloatingToolbar({
  box
}: {
  box: { left: number; top: number; width: number }
}): React.ReactElement {
  const selectedIds = useEditor((s) => s.selectedIds)
  const shapes = useEditor((s) => s.doc?.shapes)
  const picked = (shapes ?? []).filter((s) => selectedIds.includes(s.id))
  const first = picked[0]

  const apply = (patch: Partial<Shape>) => {
    const state = useEditor.getState()
    state.begin()
    state.updateShapes(Object.fromEntries(selectedIds.map((id) => [id, patch])))
    state.end()
  }

  const setColour = (colour: string) => {
    const state = useEditor.getState()
    state.begin()
    state.updateShapes(
      Object.fromEntries(
        picked.map((s) => [
          s.id,
          s.type === 'text' || s.type === 'callout'
            ? ({ color: colour } as Partial<Shape>)
            : s.type === 'step'
              ? ({ fill: colour } as Partial<Shape>)
              : ({ stroke: colour } as Partial<Shape>)
        ])
      )
    )
    state.end()
    state.setStyle({ color: colour, fill: colour })
  }

  // Blur and redact regions carry a strokeWidth of 0; a width stepper there is noise.
  const rawWidth =
    first && 'strokeWidth' in first ? (first as { strokeWidth: number }).strokeWidth : 0
  const width = rawWidth > 0 ? rawWidth : null

  // Sit above the selection unless that would clip off the top of the canvas.
  const above = box.top > 54
  return (
    <div
      className="float-bar"
      style={{
        left: Math.max(4, box.left + box.width / 2),
        top: above ? box.top - 46 : box.top + 8,
        transform: 'translateX(-50%)'
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {QUICK_COLOURS.map((c) => (
        <button
          key={c}
          className="float-swatch"
          style={{ background: c }}
          title={c}
          onClick={() => setColour(c)}
        />
      ))}

      {width !== null && (
        <>
          <span className="float-sep" />
          <button
            className="float-btn"
            title="Thinner"
            onClick={() => apply({ strokeWidth: Math.max(1, width - 2) } as Partial<Shape>)}
          >
            <Icon name="minus" size={13} />
          </button>
          <span className="float-value mono">{Math.round(width)}</span>
          <button
            className="float-btn"
            title="Thicker"
            onClick={() => apply({ strokeWidth: Math.min(60, width + 2) } as Partial<Shape>)}
          >
            <Icon name="plus" size={13} />
          </button>
        </>
      )}

      <span className="float-sep" />
      <button
        className="float-btn"
        title="Duplicate  ·  ⌘D"
        onClick={() => useEditor.getState().duplicateSelected()}
      >
        <Icon name="copy" size={13} />
      </button>
      <button
        className="float-btn"
        title="Bring to front"
        onClick={() => selectedIds.forEach((id) => useEditor.getState().reorder(id, 'front'))}
      >
        <Icon name="layers" size={13} />
      </button>
      <button
        className="float-btn danger"
        title="Delete  ·  ⌫"
        onClick={() => useEditor.getState().removeShapes(selectedIds)}
      >
        <Icon name="trash" size={13} />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Shared framing
 * ------------------------------------------------------------------ */

const rad = (deg: number) => (deg * Math.PI) / 180

function roundedRectPath(
  ctx: Konva.Context | CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.arcTo(x + w, y, x + w, y + radius, radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  ctx.lineTo(x + radius, y + h)
  ctx.arcTo(x, y + h, x, y + h - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

/**
 * Positions its children over the screenshot, applying padding, tilt and (optionally)
 * the rounded-corner clip. Every layer uses this so they stay perfectly registered.
 */
function ShotFrame({
  layout,
  canvas,
  clip,
  children
}: {
  layout: Layout
  canvas: CanvasStyle
  clip?: boolean
  children: React.ReactNode
}): React.ReactElement {
  const tilted = canvas.tiltX !== 0 || canvas.tiltY !== 0
  const frameH = layout.frameHeight
  const tilt = canvasTiltTransform(canvas)

  const outer = tilted
    ? {
        x: layout.shotX + layout.contentWidth / 2,
        y: layout.shotY + (layout.contentHeight + frameH) / 2,
        offsetX: layout.contentWidth / 2,
        offsetY: (layout.contentHeight + frameH) / 2,
        // Konva has no perspective camera, so tilt is a skew + foreshortening pair —
        // the same trick design tools use for "3D" mockups.
        skewY: tilt.skewY,
        skewX: tilt.skewX,
        scaleX: tilt.scaleX,
        scaleY: tilt.scaleY
      }
    : { x: layout.shotX, y: layout.shotY }

  const inner = clip
    ? {
        y: frameH,
        clipFunc: (ctx: Konva.Context) =>
          roundedRectPath(
            ctx,
            0,
            0,
            layout.contentWidth,
            layout.contentHeight,
            canvas.frame === 'none' ? canvas.radius : 0
          )
      }
    : { y: frameH }

  return (
    <Group {...outer}>
      <Group {...inner}>{children}</Group>
    </Group>
  )
}

/* ------------------------------------------------------------------ *
 * Base layer — the screenshot and its presentation
 * ------------------------------------------------------------------ */

const BaseLayer = React.memo(function BaseLayer({
  image,
  layout,
  canvas
}: {
  image: HTMLImageElement
  layout: Layout
  canvas: CanvasStyle
}): React.ReactElement {
  const frameH = layout.frameHeight
  const backgroundFill =
    canvas.background === 'gradient'
      ? {
          fillLinearGradientStartPoint: { x: 0, y: 0 },
          fillLinearGradientEndPoint: {
            x: layout.canvasWidth * Math.cos(rad(canvas.gradientAngle)),
            y: layout.canvasHeight * Math.sin(rad(canvas.gradientAngle))
          },
          fillLinearGradientColorStops: [0, canvas.gradientFrom, 1, canvas.gradientTo]
        }
      : canvas.background === 'solid'
        ? { fill: canvas.backgroundColor }
        : { fill: 'rgba(0,0,0,0)' }

  return (
    <Layer listening>
      <Rect
        name="backdrop"
        width={layout.canvasWidth}
        height={layout.canvasHeight}
        {...backgroundFill}
      />

      <ShotFrame layout={layout} canvas={canvas}>
        {/* children of ShotFrame are offset by frameH, so undo it for full-height art */}
        <Group y={-frameH}>
          {canvas.shadowBlur > 0 && (
            <Rect
              width={layout.contentWidth}
              height={layout.contentHeight + frameH}
              cornerRadius={canvas.radius}
              fill="#000"
              opacity={0.001}
              shadowColor="#000000"
              shadowBlur={canvas.shadowBlur}
              shadowOffsetY={canvas.shadowOffsetY}
              shadowOpacity={canvas.shadowOpacity}
              listening={false}
            />
          )}

          {canvas.frame !== 'none' && (
            <Group listening={false}>
              <Rect
                width={layout.contentWidth}
                height={frameH + canvas.radius}
                cornerRadius={[canvas.radius, canvas.radius, 0, 0]}
                fill={canvas.frame === 'macos' ? '#2c2f36' : '#1f1f1f'}
              />
              {canvas.frame === 'macos'
                ? ['#ff5f56', '#ffbd2e', '#27c93f'].map((color, i) => (
                    <Circle key={color} x={18 + i * 20} y={frameH / 2} radius={6} fill={color} />
                  ))
                : [0, 1, 2].map((i) => (
                    <Rect
                      key={i}
                      x={layout.contentWidth - 76 + i * 24}
                      y={frameH / 2 - 5}
                      width={10}
                      height={10}
                      stroke="#c8c8c8"
                      strokeWidth={1.2}
                      cornerRadius={i === 2 ? 5 : 0}
                    />
                  ))}
              {canvas.frameTitle && (
                <KonvaText
                  width={layout.contentWidth}
                  y={frameH / 2 - 7}
                  align="center"
                  text={canvas.frameTitle}
                  fontSize={13}
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                  fill="#d5d9e0"
                />
              )}
            </Group>
          )}

          <Group
            y={frameH}
            clipFunc={(ctx) =>
              roundedRectPath(
                ctx,
                0,
                0,
                layout.contentWidth,
                layout.contentHeight,
                canvas.frame === 'none' ? canvas.radius : 0
              )
            }
          >
            <KonvaImage
              image={image}
              width={layout.contentWidth}
              height={layout.contentHeight}
              crop={{
                x: layout.cropX,
                y: layout.cropY,
                width: layout.contentWidth,
                height: layout.contentHeight
              }}
              listening={false}
            />
          </Group>

          {canvas.borderWidth > 0 && (
            <Rect
              width={layout.contentWidth}
              height={layout.contentHeight + frameH}
              cornerRadius={canvas.radius}
              stroke={canvas.borderColor}
              strokeWidth={canvas.borderWidth}
              listening={false}
            />
          )}
        </Group>
      </ShotFrame>
    </Layer>
  )
})

/* ------------------------------------------------------------------ *
 * Crop overlay
 * ------------------------------------------------------------------ */

function CropOverlay({
  draft,
  layout
}: {
  draft: { x: number; y: number; width: number; height: number } | null
  layout: Layout
}): React.ReactElement {
  const view = {
    x: layout.cropX,
    y: layout.cropY,
    width: layout.contentWidth,
    height: layout.contentHeight
  }
  const box = draft ?? view

  const bands = [
    { x: view.x, y: view.y, width: view.width, height: Math.max(0, box.y - view.y) },
    {
      x: view.x,
      y: box.y + box.height,
      width: view.width,
      height: Math.max(0, view.y + view.height - (box.y + box.height))
    },
    { x: view.x, y: box.y, width: Math.max(0, box.x - view.x), height: box.height },
    {
      x: box.x + box.width,
      y: box.y,
      width: Math.max(0, view.x + view.width - (box.x + box.width)),
      height: box.height
    }
  ]

  return (
    <Group
      x={layout.shotX - layout.cropX}
      y={layout.shotY + layout.frameHeight - layout.cropY}
      listening={false}
    >
      {bands.map((b, i) => (
        <Rect key={i} {...b} fill="#000" opacity={0.55} />
      ))}
      <Rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        stroke="#ffffff"
        strokeWidth={1.5}
        dash={[6, 4]}
      />
    </Group>
  )
}

function CutOutOverlay({
  draft,
  layout
}: {
  draft: CutOutOperation | null
  layout: Layout
}): React.ReactElement {
  if (!draft || draft.size <= 0) return <Group listening={false} />

  const width = draft.source.width
  const height = draft.source.height
  const length = draft.axis === 'horizontal' ? width : height
  const amplitude = cutOutEdgeAmplitude(draft, length)
  const startPath = cutOutEdgePath(draft.axis, length, draft.start, draft.edge, amplitude)
  const endPath = cutOutEdgePath(draft.axis, length, draft.start + draft.size, draft.edge, amplitude)

  return (
    <Group
      x={layout.shotX}
      y={layout.shotY + layout.frameHeight}
      listening={false}
    >
      <Rect
        x={draft.axis === 'vertical' ? draft.start : 0}
        y={draft.axis === 'horizontal' ? draft.start : 0}
        width={draft.axis === 'vertical' ? draft.size : width}
        height={draft.axis === 'horizontal' ? draft.size : height}
        fill="#000000"
        opacity={0.48}
      />
      <Line points={startPath} stroke="#ffffff" strokeWidth={2} dash={[7, 5]} shadowColor="#000" shadowBlur={3} shadowOpacity={0.6} />
      <Line points={endPath} stroke="#ffffff" strokeWidth={2} dash={[7, 5]} shadowColor="#000" shadowBlur={3} shadowOpacity={0.6} />
    </Group>
  )
}

export type { ClipDocument, TextShape, ToolId }
