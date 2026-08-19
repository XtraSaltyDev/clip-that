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
import type {
  CanvasStyle,
  ClipDocument,
  CutOutOperation,
  Shape,
  TextShape,
  ToolId
} from '@shared/types'
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
import { LineControls, type DirectLineGesture } from './LineControls'
import {
  cancelDirectGesture,
  captureDirectGestureSnapshot,
  isCancelledDirectGesture,
  restoreDirectGestureSnapshot,
  type DirectGestureSnapshot
} from './direct-gesture'
import { shapeTransformPatch } from './transforms'
import {
  BODY_DRAG_VISIBILITY_MARGIN_SCREEN,
  beginProvisionalMultiSelection,
  bodyDragPatch,
  bodyTranslationPatch,
  clampCommonTranslationToRecoveryGroups,
  clampTranslationToRecoveryRects,
  constrainLineEndpoint,
  effectiveLinePoints,
  endpointEditPatch,
  finishProvisionalMultiSelection,
  interactiveRecoveryRects,
  isInteractiveDirectLineShape,
  lineCurveOffset,
  lineCurvePoint,
  lineEndpoint,
  normalizedLinePatch,
  pointsCenter,
  selectionAfterPointerDown,
  shouldContinueBodyDragAfterMouseLeave,
  snapTranslationToLines,
  unionDragRects,
  type DragBounds,
  type DragRect,
  type LineEndpoint,
  type Point,
  type ProvisionalMultiSelection
} from './geometry'
import { canvasTiltTransform } from './tilt'
import { expandedAnnotationInsets } from './annotation-bounds'
import {
  ROTATE_ICON_SIZE,
  clampToolbarCenter,
  floatingToolbarHidden,
  floatingToolbarShown,
  floatingToolbarTop,
  floatingToolbarWithBounds,
  horizontalViewportBounds,
  isFloatingToolbarVisible,
  type FloatingToolbarBox,
  type FloatingToolbarState
} from './rotation-handle'
import { useRotateHandle } from './use-rotate-handle'
import { computeLayout, fitScale, type Layout } from '../layout'
import { Icon } from '../../shared/icons'
import LiveText from './LiveText'

interface Props {
  image: HTMLImageElement
  containerWidth: number
  containerHeight: number
  stageRef: React.MutableRefObject<Konva.Stage | null>
  viewportRef: React.MutableRefObject<HTMLDivElement | null>
  onContextMenuRequest: (target: {
    kind: 'canvas' | 'selection'
    point: { x: number; y: number }
  }) => void
}

/** Snap threshold in image pixels, scaled so it feels constant on screen. */
const SNAP_PX = 6
const FLOATING_TOOLBAR_EDGE_PADDING = 24

type EditorState = ReturnType<typeof useEditor.getState>
type DirectHistory = EditorState['past'][number]
type DirectSnapshot = DirectGestureSnapshot<DirectHistory>

interface MultiDragEntry {
  id: string
  node: Konva.Node
  origin: Point
  rect: DragRect
  recoveryRects: DragRect[]
}

interface MultiDragGesture {
  anchorId: string
  entries: MultiDragEntry[]
  delta: Point
  rawDelta: Point
}

interface BodyDragGesture {
  id: string
  node: Konva.Node
  origin: Point
  rect: DragRect
  recoveryRects: DragRect[]
  dragging: boolean
  rawDelta: Point
}

/** Some composite shapes expose their painted body as a draggable child of a non-draggable owner. */
function draggableBodyNode(node: Konva.Node): Konva.Node | null {
  if (node.draggable()) return node
  const container = node as Konva.Container
  if (typeof container.findOne !== 'function') return null
  return (
    container.findOne((candidate: Konva.Node) => candidate.draggable() && candidate.listening()) ??
    null
  )
}

export default function EditorStage({
  image,
  containerWidth,
  containerHeight,
  stageRef,
  viewportRef,
  onContextMenuRequest
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
  } = useEditor.getState()

  const shapesGroupRef = useRef<Konva.Group>(null)
  const artLayerRef = useRef<Konva.Layer>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const rotateIconGroupRef = useRef<Konva.Group>(null)
  const stageRootRef = useRef<HTMLDivElement>(null)
  const drafting = useRef<{ id: string; origin: { x: number; y: number } } | null>(null)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const directGesture = useRef<{
    id: string
    kind: DirectLineGesture
    snapshot: DirectSnapshot
    cancelled: boolean
  } | null>(null)
  const pendingMultiDrag = useRef<{ anchorId: string; entries: MultiDragEntry[] } | null>(null)
  const pendingSelection = useRef<{
    gesture: ProvisionalMultiSelection
    dragging: boolean
  } | null>(null)
  const multiDrag = useRef<MultiDragGesture | null>(null)
  const bodyDrag = useRef<BodyDragGesture | null>(null)
  const [guides, setGuides] = useState<Array<{ x?: number; y?: number }>>([])
  const [textBox, setTextBox] = useState<{ left: number; top: number; width: number } | null>(null)
  const [toolbarState, setToolbarState] = useState<FloatingToolbarState>(() =>
    floatingToolbarShown(null)
  )

  /**
   * Layout only depends on geometry, never on the shape list — keying the memo on those
   * fields is what keeps the (expensive) base layer from re-rendering while you annotate.
   */
  const layout = useMemo(
    () => (doc ? computeLayout(doc) : null),
    [doc?.crop, doc?.canvas, doc?.cutOuts, doc?.imageWidth, doc?.imageHeight]
  )

  /** Grow automatic workspace only when a committed annotation actually paints beyond it. */
  const expandAnnotations = useCallback((candidateShapes?: Shape[]) => {
    const state = useEditor.getState()
    const current = state.doc
    if (!current) return
    const next = expandedAnnotationInsets(current, undefined, candidateShapes ?? current.shapes)
    const previous = current.canvas.annotationInsets
    const same =
      (previous?.top ?? 0) === next.top &&
      (previous?.right ?? 0) === next.right &&
      (previous?.bottom ?? 0) === next.bottom &&
      (previous?.left ?? 0) === next.left
    if (!same) state.setCanvas({ annotationInsets: next })
  }, [])

  /* ---------- auto-fit ---------- */

  useLayoutEffect(() => {
    if (!layout || !autoFit || containerWidth === 0 || containerHeight === 0) return
    const scale = fitScale(layout, containerWidth, containerHeight)
    if (Math.abs(zoom - scale) < 0.0001) return
    setZoom(scale, true)
  }, [layout, autoFit, containerWidth, containerHeight, setZoom, zoom])

  /* ---------- transformer ---------- */

  const {
    beginTransform: beginRotateTransform,
    endTransform: endRotateTransform,
    syncRotateAnchor,
    scheduleRotateAnchorSync,
    styleTransformerAnchor
  } = useRotateHandle({ stageRef, transformerRef, iconRef: rotateIconGroupRef })

  const selectedDirectShape = useMemo(() => {
    if (tool !== 'select' || editingTextId || selectedIds.length !== 1 || !doc) return null
    const shape = doc.shapes.find((candidate) => candidate.id === selectedIds[0])
    return shape && isInteractiveDirectLineShape(shape) ? shape : null
  }, [doc, editingTextId, selectedIds, tool])

  useLayoutEffect(() => {
    const tr = transformerRef.current
    const layer = artLayerRef.current
    if (!tr || !layer) return
    if (tool !== 'select' || selectedIds.length === 0 || selectedDirectShape) {
      tr.nodes([])
      rotateIconGroupRef.current?.visible(false)
      layer.batchDraw()
      return
    }
    const nodes = selectedIds
      .map((id) => layer.findOne(`#${id}`))
      .filter((n): n is Konva.Node => {
        if (!n) return false
        const shape = doc?.shapes.find((candidate) => candidate.id === n.id())
        return Boolean(shape && !shape.locked && !shape.hidden)
      })
    if (nodes.length === 0) {
      tr.nodes([])
      rotateIconGroupRef.current?.visible(false)
      layer.batchDraw()
      return
    }
    tr.nodes(nodes)
    syncRotateAnchor()
    layer.batchDraw()
  }, [doc?.shapes, selectedDirectShape, selectedIds, syncRotateAnchor, tool])

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
      : {
          x: layout.cropX,
          y: layout.cropY,
          width: layout.contentWidth,
          height: layout.contentHeight
        }
  }, [doc, layout])

  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return
    const p = pointer()
    if (!p || !doc) return

    if (tool === 'select') {
      pendingSelection.current = null
      pendingMultiDrag.current = null
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
    const shape = createShape(
      tool,
      p,
      useEditor.getState().style,
      z,
      useEditor.getState().nextStepIndex()
    )
    if (!shape) return

    if (CLICK_TOOLS.includes(tool)) {
      addShape(shape)
      expandAnnotations([shape])
      // Step is intentionally repeatable: keep placing the next number until the
      // user presses Escape or chooses another tool. Other click tools remain one-shot.
      if (tool !== 'step') useEditor.getState().setTool('select')
      return
    }
    if (TEXT_TOOLS.includes(tool)) {
      addShape(shape)
      expandAnnotations([shape])
      setEditingText(shape.id)
      useEditor.getState().setTool('select')
      return
    }

    addShape(shape)
    drafting.current = { id: shape.id, origin: p }
    lastPoint.current = p
  }

  const onStageContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault()
    const point = pointer()
    if (!point || !doc) return

    const shapeIds = new Set(doc.shapes.map((shape) => shape.id))
    let node: Konva.Node | null = e.target
    let shapeId: string | null = null
    while (node) {
      if (shapeIds.has(node.id())) {
        shapeId = node.id()
        break
      }
      node = node.getParent()
    }

    if (shapeId) {
      if (!selectedIds.includes(shapeId)) select([shapeId])
      onContextMenuRequest({ kind: 'selection', point })
      return
    }
    onContextMenuRequest({ kind: 'canvas', point })
  }

  const onStageMouseMove = useCallback(() => {
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
      updateShape(draft.id, {
        points: [draft.origin.x, draft.origin.y, p.x, p.y]
      } as Partial<Shape>)
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
  }, [cutOutPointer, pointer, setCropDraft, setCutOutDraft, updateShape, zoom])

  const onStageMouseUp = useCallback(() => {
    const activeBodyGesture = shouldContinueBodyDragAfterMouseLeave({
      captured: Boolean(bodyDrag.current),
      dragging: Boolean(bodyDrag.current?.dragging),
      collective: Boolean(multiDrag.current)
    })
    if (!activeBodyGesture) {
      const pending = pendingSelection.current
      if (pending && !pending.dragging && !multiDrag.current) {
        select(finishProvisionalMultiSelection(pending.gesture, false))
      }
      pendingSelection.current = null
      pendingMultiDrag.current = null
      bodyDrag.current = null
    }

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
    expandAnnotations()
    useEditor.getState().setTool('select')
  }, [expandAnnotations, select])

  const captureMultiDrag = useCallback((id: string, additive: boolean) => {
    const state = useEditor.getState()
    const layer = artLayerRef.current
    const owner = layer?.findOne(`#${id}`)
    const node = owner ? draggableBodyNode(owner) : null
    const shape = state.doc?.shapes.find((candidate) => candidate.id === id)
    const recoveryRects = shape ? interactiveRecoveryRects(shape, state.zoom) : []
    const rect = unionDragRects(recoveryRects)

    if (
      state.tool === 'select' &&
      !additive &&
      shape &&
      !shape.locked &&
      !shape.hidden &&
      node &&
      rect
    ) {
      bodyDrag.current = {
        id,
        node,
        origin: { x: node.x(), y: node.y() },
        rect,
        recoveryRects,
        dragging: false,
        rawDelta: { x: 0, y: 0 }
      }
    } else {
      bodyDrag.current = null
    }

    if (
      !layer ||
      state.tool !== 'select' ||
      state.selectedIds.length < 2 ||
      !state.selectedIds.includes(id) ||
      additive
    ) {
      pendingMultiDrag.current = null
      pendingSelection.current = null
      return
    }

    const entries = state.selectedIds
      .map((selectedId) => {
        const shape = state.doc?.shapes.find((candidate) => candidate.id === selectedId)
        const owner = layer.findOne(`#${selectedId}`)
        const node = owner ? draggableBodyNode(owner) : null
        const recoveryRects = shape ? interactiveRecoveryRects(shape, state.zoom) : []
        const rect = unionDragRects(recoveryRects)
        if (!shape || shape.locked || shape.hidden || !node || !rect) return null
        return {
          id: selectedId,
          node,
          origin: { x: node.x(), y: node.y() },
          rect,
          recoveryRects
        }
      })
      .filter((entry): entry is MultiDragEntry => Boolean(entry))

    const provisional = beginProvisionalMultiSelection(state.selectedIds, id, additive)
    pendingMultiDrag.current =
      entries.length > 1 && entries.some((entry) => entry.id === id) && provisional
        ? { anchorId: id, entries }
        : null
    pendingSelection.current =
      pendingMultiDrag.current && provisional ? { gesture: provisional, dragging: false } : null
  }, [])

  /**
   * Body recovery is constrained by the portion of the content that is actually editable and
   * visible through the overflow viewport. At high zoom the full document can extend below or
   * beside that viewport; using only the document bounds would leave a tiny clipped slice that
   * cannot be reacquired until the user happens to scroll.
   */
  const visibleContentBounds = useCallback((): DragBounds => {
    if (!layout) return { left: 0, top: 0, right: 0, bottom: 0 }
    const contentOriginX = layout.shotX
    const contentOriginY = layout.shotY + layout.frameHeight
    const full = {
      left: layout.cropX - contentOriginX,
      top: layout.cropY - contentOriginY,
      right: layout.cropX + layout.canvasWidth - contentOriginX,
      bottom: layout.cropY + layout.canvasHeight - contentOriginY
    }
    const stage = stageRef.current?.container()
    const viewport = viewportRef.current
    if (!stage || !viewport) return full

    const stageRect = stage.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const visibleLeft = Math.max(stageRect.left, viewportRect.left)
    const visibleRight = Math.min(stageRect.right, viewportRect.right)
    const visibleTop = Math.max(stageRect.top, viewportRect.top)
    const visibleBottom = Math.min(stageRect.bottom, viewportRect.bottom)
    if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return full

    const scale = Math.max(zoom, 0.05)
    const localLeft = Math.max(0, (visibleLeft - stageRect.left) / scale)
    const localRight = Math.min(layout.canvasWidth, (visibleRight - stageRect.left) / scale)
    const localTop = Math.max(0, (visibleTop - stageRect.top) / scale)
    const localBottom = Math.min(layout.canvasHeight, (visibleBottom - stageRect.top) / scale)
    if (localRight <= localLeft || localBottom <= localTop) return full

    return {
      left: layout.cropX + localLeft - contentOriginX,
      top: layout.cropY + localTop - contentOriginY,
      right: layout.cropX + localRight - contentOriginX,
      bottom: layout.cropY + localBottom - contentOriginY
    }
  }, [layout, stageRef, viewportRef, zoom])

  /* ---------- alignment guides while dragging ---------- */

  const onDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const eventNode = e.target
      const state = useEditor.getState()
      const current = state.doc
      const layoutNow = layout
      if (!current || !layoutNow) return

      // A few shape families use a draggable child inside the id-bearing group (for example
      // spotlight). Prefer the actual drag target when it is already moving, otherwise route
      // the event to the owning shape group.
      const node =
        eventNode.isDragging() || eventNode.draggable()
          ? eventNode
          : (eventNode.findAncestor('.shape', true) ?? eventNode)
      if (node === shapesGroupRef.current) return

      const contentBounds = visibleContentBounds()
      const visibilityMargin = BODY_DRAG_VISIBILITY_MARGIN_SCREEN / Math.max(zoom, 0.05)

      const activeMultiDrag = multiDrag.current
      if (activeMultiDrag) {
        const anchor = activeMultiDrag.entries.find(
          (entry) => entry.id === activeMultiDrag.anchorId
        )
        const union = unionDragRects(activeMultiDrag.entries.map((entry) => entry.rect))
        if (anchor && union) {
          const desired = {
            x: anchor.node.x() - anchor.origin.x,
            y: anchor.node.y() - anchor.origin.y
          }
          activeMultiDrag.rawDelta = desired
          const selected = new Set(activeMultiDrag.entries.map((entry) => entry.id))
          const vLines: number[] = [layoutNow.cropX + layoutNow.contentWidth / 2]
          const hLines: number[] = [layoutNow.cropY + layoutNow.contentHeight / 2]
          for (const other of current.shapes) {
            if (selected.has(other.id) || !('x' in other)) continue
            const width = 'width' in other ? Math.abs(other.width) : 0
            const height = 'height' in other ? Math.abs(other.height ?? 0) : 0
            vLines.push(other.x, other.x + width / 2, other.x + width)
            hLines.push(other.y, other.y + height / 2, other.y + height)
          }

          const snapped = snapTranslationToLines(
            union,
            desired,
            vLines,
            hLines,
            SNAP_PX / Math.max(zoom, 0.05)
          )
          const constrained = clampCommonTranslationToRecoveryGroups(
            activeMultiDrag.entries.map((entry) => entry.recoveryRects),
            snapped.translation,
            contentBounds,
            visibilityMargin
          )
          for (const entry of activeMultiDrag.entries) {
            entry.node.position({
              x: entry.origin.x + constrained.x,
              y: entry.origin.y + constrained.y
            })
          }
          activeMultiDrag.delta = constrained
          setGuides(snapped.guides)
          return
        }
      }

      const nodeId = node.id() || node.findAncestor('.shape', true)?.id()
      const shape = current.shapes.find((candidate) => candidate.id === nodeId)
      const activeBody =
        bodyDrag.current && (bodyDrag.current.node === node || bodyDrag.current.id === nodeId)
          ? bodyDrag.current
          : null
      const recoveryRects =
        activeBody?.recoveryRects ?? (shape ? interactiveRecoveryRects(shape, zoom) : [])
      const recoveryRect = activeBody?.rect ?? unionDragRects(recoveryRects)
      if (!recoveryRect) return
      const origin = activeBody?.origin ?? { x: node.x(), y: node.y() }
      const desired = {
        x: node.x() - origin.x,
        y: node.y() - origin.y
      }
      if (activeBody) activeBody.rawDelta = desired
      const threshold = SNAP_PX / Math.max(zoom, 0.05)
      const contentCenterX = layoutNow.cropX + layoutNow.contentWidth / 2
      const contentCenterY = layoutNow.cropY + layoutNow.contentHeight / 2

      // Candidate lines: the canvas centre plus every other shape's edges and centre.
      const vLines: number[] = [contentCenterX]
      const hLines: number[] = [contentCenterY]
      for (const other of current.shapes) {
        if (other.id === nodeId || !('x' in other)) continue
        const ow = 'width' in other ? Math.abs(other.width) : 0
        const oh = 'height' in other ? Math.abs(other.height ?? 0) : 0
        vLines.push(other.x, other.x + ow / 2, other.x + ow)
        hLines.push(other.y, other.y + oh / 2, other.y + oh)
      }

      const snapped = snapTranslationToLines(recoveryRect, desired, vLines, hLines, threshold)
      const constrained = clampTranslationToRecoveryRects(
        recoveryRects,
        snapped.translation,
        contentBounds,
        visibilityMargin
      )
      node.position({ x: origin.x + constrained.x, y: origin.y + constrained.y })
      setGuides(snapped.guides)
    },
    [layout, visibleContentBounds, zoom]
  )

  /**
   * Shape nodes are memoised, so their handlers must be referentially stable —
   * read the live selection from the store rather than closing over it.
   */
  const onSelectShape = useCallback((id: string, additive: boolean) => {
    const current = useEditor.getState().selectedIds
    useEditor
      .getState()
      .select(
        selectionAfterPointerDown(
          current,
          id,
          additive,
          !additive &&
            current.length > 1 &&
            current.includes(id) &&
            Boolean(pendingSelection.current)
        )
      )
  }, [])

  const commitShapeChange = useCallback(
    (id: string, patch: Partial<Shape>) => {
      if (isCancelledDirectGesture(directGesture.current, id) || multiDrag.current) return
      const state = useEditor.getState()
      const activeBody = bodyDrag.current && bodyDrag.current.id === id ? bodyDrag.current : null
      const shape = state.doc?.shapes.find((candidate) => candidate.id === id)
      let committedPatch = patch
      if (activeBody && shape && layout && state.doc) {
        const nodeDesired = {
          x: activeBody.node.x() - activeBody.origin.x,
          y: activeBody.node.y() - activeBody.origin.y
        }
        const desired =
          activeBody.rawDelta.x !== 0 || activeBody.rawDelta.y !== 0
            ? activeBody.rawDelta
            : nodeDesired
        const constrained = clampTranslationToRecoveryRects(
          activeBody.recoveryRects,
          nodeDesired,
          visibleContentBounds(),
          BODY_DRAG_VISIBILITY_MARGIN_SCREEN / Math.max(zoom, 0.05)
        )
        const rawPatch = isInteractiveDirectLineShape(shape)
          ? bodyDragPatch(shape, desired.x, desired.y)
          : bodyTranslationPatch(shape, desired.x, desired.y)
        const rawShape = { ...shape, ...rawPatch } as Shape
        const expanded = expandedAnnotationInsets(state.doc, undefined, [rawShape])
        const previous = state.doc.canvas.annotationInsets
        const grows =
          (previous?.top ?? 0) !== expanded.top ||
          (previous?.right ?? 0) !== expanded.right ||
          (previous?.bottom ?? 0) !== expanded.bottom ||
          (previous?.left ?? 0) !== expanded.left
        const delta = grows ? desired : constrained
        activeBody.node.position({
          x: activeBody.origin.x + delta.x,
          y: activeBody.origin.y + delta.y
        })
        committedPatch = isInteractiveDirectLineShape(shape)
          ? bodyDragPatch(shape, delta.x, delta.y)
          : bodyTranslationPatch(shape, delta.x, delta.y)
        if (grows) state.setCanvas({ annotationInsets: expanded })
      }
      state.updateShape(id, committedPatch)
      state.end()
    },
    [layout, visibleContentBounds, zoom]
  )

  const readSelectionBox = useCallback((): FloatingToolbarBox | null => {
    const layer = artLayerRef.current
    const current = useEditor.getState()
    if (
      !layer ||
      current.tool !== 'select' ||
      current.selectedIds.length === 0 ||
      current.editingTextId
    ) {
      return null
    }
    const nodes = current.selectedIds
      .map((id) => layer.findOne(`#${id}`))
      .filter((n): n is Konva.Node => Boolean(n))
    if (nodes.length === 0) return null

    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const node of nodes) {
      const rect = node.getClientRect()
      left = Math.min(left, rect.x)
      top = Math.min(top, rect.y)
      right = Math.max(right, rect.x + rect.width)
      bottom = Math.max(bottom, rect.y + rect.height)
    }
    const rootRect = stageRootRef.current?.getBoundingClientRect()
    const viewportRect = viewportRef.current?.getBoundingClientRect()
    const visibleBounds =
      rootRect && viewportRect
        ? horizontalViewportBounds(rootRect.left, viewportRect.left, viewportRect.right)
        : null
    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
      ...(visibleBounds
        ? { visibleLeft: visibleBounds.left, visibleRight: visibleBounds.right }
        : {})
    }
  }, [viewportRef])

  const refreshSelectionBox = useCallback(() => {
    setToolbarState((state) => floatingToolbarWithBounds(state, readSelectionBox()))
  }, [readSelectionBox])

  const revealToolbar = useCallback(() => {
    setToolbarState(floatingToolbarShown(readSelectionBox()))
    // Konva applies the committed React props on the next frame. Refresh once more so the
    // screen-space toolbar cannot retain a pre-gesture node rect for a frame.
    requestAnimationFrame(refreshSelectionBox)
  }, [readSelectionBox, refreshSelectionBox])

  const beginShapeTransform = useCallback(() => {
    setToolbarState(floatingToolbarHidden())
  }, [])

  const finishShapeTransform = useCallback(() => {
    setGuides([])
    const gesture = directGesture.current
    if (gesture?.cancelled) {
      directGesture.current = null
      bodyDrag.current = null
      pendingSelection.current = null
      return
    }
    const collective = multiDrag.current
    if (collective) {
      const state = useEditor.getState()
      if (collective.delta.x !== 0 || collective.delta.y !== 0) {
        const rawShapes = collective.entries
          .map((entry) => {
            const shape = state.doc?.shapes.find((candidate) => candidate.id === entry.id)
            return shape
              ? ({
                  ...shape,
                  ...bodyTranslationPatch(shape, collective.rawDelta.x, collective.rawDelta.y)
                } as Shape)
              : null
          })
          .filter((shape): shape is Shape => Boolean(shape))
        const expanded = state.doc
          ? expandedAnnotationInsets(state.doc, undefined, rawShapes)
          : undefined
        const previous = state.doc?.canvas.annotationInsets
        const grows = Boolean(
          expanded &&
          ((previous?.top ?? 0) !== expanded.top ||
            (previous?.right ?? 0) !== expanded.right ||
            (previous?.bottom ?? 0) !== expanded.bottom ||
            (previous?.left ?? 0) !== expanded.left)
        )
        const delta = grows ? collective.rawDelta : collective.delta
        for (const entry of collective.entries) {
          const shape = state.doc?.shapes.find((candidate) => candidate.id === entry.id)
          if (shape) {
            state.updateShape(shape.id, bodyTranslationPatch(shape, delta.x, delta.y))
          }
        }
        if (grows && expanded) state.setCanvas({ annotationInsets: expanded })
      }
      state.end()
      multiDrag.current = null
      pendingMultiDrag.current = null
    }
    bodyDrag.current = null
    pendingSelection.current = null
    if (gesture?.kind === 'body') directGesture.current = null
    // Single-object child drag-end handlers commit before this bubbles. Collective drags commit
    // above, before the shared toolbar is revealed from the final bounds.
    revealToolbar()
  }, [revealToolbar])

  const beginTransformerTransform = useCallback(() => {
    setToolbarState(floatingToolbarHidden())
    begin()
    beginRotateTransform()
  }, [begin, beginRotateTransform])

  const commitTransform = useCallback(() => {
    const transformer = transformerRef.current
    const state = useEditor.getState()
    const current = state.doc
    if (!transformer || !current) {
      endRotateTransform()
      revealToolbar()
      return
    }

    for (const node of transformer.nodes()) {
      const shape = current.shapes.find((candidate) => candidate.id === node.id())
      if (!shape) continue
      const patch = shapeTransformPatch(shape, node)
      state.updateShape(shape.id, patch)

      // Point-based nodes keep their geometry in the document, so restore the committed
      // point-origin as well as clearing Konva's transient scale. Setting (0, 0) here is not
      // enough for rotation-only gestures: React-Konva sees unchanged point props and will not
      // replay the old origin, leaving the node displaced after mouse-up.
      if ('points' in shape && shape.type !== 'measure') {
        const points = (patch as { points: number[] }).points
        const origin = pointsCenter(points)
        node.position(origin)
      } else if (shape.type === 'measure' && 'points' in patch) {
        const points = patch.points as number[]
        node.position({ x: (points[0] + points[2]) / 2, y: (points[1] + points[3]) / 2 })
      }
      node.scaleX(1)
      node.scaleY(1)
    }
    expandAnnotations()
    // Always close the transaction, including rotation-only and multi-selection transforms.
    state.end()
    endRotateTransform()
    revealToolbar()
    transformer.getLayer()?.batchDraw()
  }, [endRotateTransform, expandAnnotations, revealToolbar])

  const snapLineEndpoint = useCallback(
    (id: string, point: Point): Point => {
      if (!layout) return point
      const threshold = SNAP_PX / Math.max(zoom, 0.05)
      const vLines: number[] = [layout.cropX + layout.contentWidth / 2]
      const hLines: number[] = [layout.cropY + layout.contentHeight / 2]
      const current = useEditor.getState().doc
      for (const other of current?.shapes ?? []) {
        if (other.id === id || !('x' in other)) continue
        const width = 'width' in other ? Math.abs(other.width) : 0
        const height = 'height' in other ? Math.abs(other.height ?? 0) : 0
        vLines.push(other.x, other.x + width / 2, other.x + width)
        hLines.push(other.y, other.y + height / 2, other.y + height)
      }

      const nearest = (value: number, candidates: number[]): number | null => {
        let best: number | null = null
        let distance = threshold
        for (const candidate of candidates) {
          const next = Math.abs(candidate - value)
          if (next < distance) {
            best = candidate
            distance = next
          }
        }
        return best
      }

      const x = nearest(point.x, vLines)
      const y = nearest(point.y, hLines)
      setGuides([...(x === null ? [] : [{ x }]), ...(y === null ? [] : [{ y }])])
      return { x: x ?? point.x, y: y ?? point.y }
    },
    [layout, zoom]
  )

  const beginDirectManipulation = useCallback((id: string, kind: DirectLineGesture) => {
    if (directGesture.current?.cancelled) directGesture.current = null
    if (directGesture.current) return
    const state = useEditor.getState()
    const shape = state.doc?.shapes.find((candidate) => candidate.id === id)
    if (!shape || !isInteractiveDirectLineShape(shape)) return
    const snapshot = captureDirectGestureSnapshot(state)
    state.begin()
    directGesture.current = { id, kind, snapshot, cancelled: false }
    setGuides([])
    setToolbarState(floatingToolbarHidden())
  }, [])

  const beginShapeDrag = useCallback(
    (id?: string) => {
      const state = useEditor.getState()
      const shape = id ? state.doc?.shapes.find((candidate) => candidate.id === id) : null
      const markBodyDragStarted = () => {
        if (bodyDrag.current && (!id || bodyDrag.current.id === id)) {
          bodyDrag.current.dragging = true
        }
      }
      const direct =
        id &&
        state.tool === 'select' &&
        state.selectedIds.length === 1 &&
        state.selectedIds[0] === id &&
        shape &&
        isInteractiveDirectLineShape(shape)
      if (direct && id) {
        markBodyDragStarted()
        beginDirectManipulation(id, 'body')
        return
      }
      const pending = pendingMultiDrag.current
      if (pending && pending.anchorId === id) {
        markBodyDragStarted()
        if (pendingSelection.current) pendingSelection.current.dragging = true
        multiDrag.current = {
          anchorId: pending.anchorId,
          entries: pending.entries,
          delta: { x: 0, y: 0 },
          rawDelta: { x: 0, y: 0 }
        }
        pendingMultiDrag.current = null
        state.begin()
        return
      }
      pendingMultiDrag.current = null
      pendingSelection.current = null
      markBodyDragStarted()
      state.begin()
    },
    [beginDirectManipulation]
  )

  const updateDirectEndpoint = useCallback(
    (id: string, endpoint: LineEndpoint, point: Point, shift: boolean): Point => {
      const state = useEditor.getState()
      const shape = state.doc?.shapes.find((candidate) => candidate.id === id)
      if (!shape || !isInteractiveDirectLineShape(shape)) return point

      const effective = effectiveLinePoints(shape)
      const anchor = lineEndpoint(effective, endpoint === 'start' ? 'end' : 'start')
      const nextPoint = shift ? constrainLineEndpoint(point, anchor) : snapLineEndpoint(id, point)
      if (shift) setGuides([])
      state.updateShape(id, endpointEditPatch(shape, endpoint, nextPoint))
      return nextPoint
    },
    [snapLineEndpoint]
  )

  const updateDirectCurve = useCallback((id: string, point: Point): Point => {
    const state = useEditor.getState()
    const shape = state.doc?.shapes.find((candidate) => candidate.id === id)
    if (!shape || !isInteractiveDirectLineShape(shape) || shape.curve === undefined) return point
    const points = effectiveLinePoints(shape)
    const curve = lineCurveOffset(points, point)
    const patch = normalizedLinePatch(shape, points)
    patch.curve = curve
    state.updateShape(id, patch)
    return lineCurvePoint(points, curve)
  }, [])

  const endDirectManipulation = useCallback(() => {
    const gesture = directGesture.current
    if (!gesture) return
    directGesture.current = null
    if (gesture.cancelled) {
      setGuides([])
      return
    }
    expandAnnotations()
    useEditor.getState().end()
    setGuides([])
    revealToolbar()
  }, [expandAnnotations, revealToolbar])

  const resetDirectNode = useCallback((id: string, restoredDoc: ClipDocument | null) => {
    const shape = restoredDoc?.shapes.find((candidate) => candidate.id === id)
    const node = artLayerRef.current?.findOne(`#${id}`)
    if (!shape || !node || !('points' in shape)) return
    const points = effectiveLinePoints(shape)
    const origin =
      shape.type === 'measure'
        ? { x: (points[0] + points[2]) / 2, y: (points[1] + points[3]) / 2 }
        : pointsCenter(points)
    node.position(origin)
    node.scaleX(1)
    node.scaleY(1)
  }, [])

  const cancelDirectManipulation = useCallback(() => {
    const gesture = directGesture.current
    if (!gesture || gesture.cancelled) return
    const state = useEditor.getState()
    const restored = restoreDirectGestureSnapshot(gesture.snapshot)
    useEditor.setState({
      ...restored,
      selectedIds: state.tool === 'select' ? restored.selectedIds : state.selectedIds
    })
    resetDirectNode(gesture.id, restored.doc)
    directGesture.current = cancelDirectGesture(gesture)
    bodyDrag.current = null
    pendingSelection.current = null
    pendingMultiDrag.current = null
    setGuides([])
    revealToolbar()
  }, [resetDirectNode, revealToolbar])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !directGesture.current) return
      event.preventDefault()
      cancelDirectManipulation()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      cancelDirectManipulation()
    }
  }, [cancelDirectManipulation])

  useEffect(() => {
    const gesture = directGesture.current
    if (
      gesture &&
      !gesture.cancelled &&
      (tool !== 'select' || selectedIds.length !== 1 || selectedIds[0] !== gesture.id)
    ) {
      cancelDirectManipulation()
    }
  }, [cancelDirectManipulation, selectedIds, tool])

  useEffect(() => {
    const onWindowMouseMove = (event: MouseEvent) => {
      const draft = drafting.current
      if (!draft || draft.id === 'crop' || draft.id === 'cutOut') return
      // Konva normally updates its pointer position from Stage mousemove events. Keep the
      // same coordinate path alive after a drawing gesture crosses the canvas edge so the raw
      // intended annotation bounds are not truncated at the old Stage boundary.
      stageRef.current?.setPointersPositions(event)
      onStageMouseMove()
    }
    const onWindowMouseUp = () => {
      // Konva owns the terminal event for an active drag, including one that ends outside the
      // Stage. Draft annotations are the one exception: their Stage mouseup is unavailable
      // after leaving the canvas, so finalize them through this global terminal event.
      if (bodyDrag.current?.dragging || multiDrag.current) return
      if (drafting.current) {
        onStageMouseUp()
        return
      }
      const pending = pendingSelection.current
      if (pending) select(finishProvisionalMultiSelection(pending.gesture, false))
      pendingSelection.current = null
      pendingMultiDrag.current = null
      bodyDrag.current = null
    }
    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('mouseup', onWindowMouseUp)
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mouseup', onWindowMouseUp)
    }
  }, [onStageMouseMove, onStageMouseUp, select, stageRef])

  /* ---------- floating toolbar position ---------- */

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onScroll = () => refreshSelectionBox()
    const onResize = () => refreshSelectionBox()
    viewport.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      viewport.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [refreshSelectionBox, viewportRef])

  useLayoutEffect(() => {
    refreshSelectionBox()
  }, [
    containerHeight,
    containerWidth,
    selectedIds,
    doc?.shapes,
    zoom,
    tool,
    editingTextId,
    guides,
    refreshSelectionBox
  ])

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
    <div ref={stageRootRef} style={{ position: 'relative' }}>
      <Stage
        ref={(node) => {
          stageRef.current = node
        }}
        width={layout.canvasWidth * zoom}
        height={layout.canvasHeight * zoom}
        scaleX={zoom}
        scaleY={zoom}
        onMouseDown={onStageMouseDown}
        onContextMenu={onStageContextMenu}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
        onMouseLeave={() => {
          // Direct line gestures intentionally cancel on leave. Ordinary Konva body drags use
          // global drag listeners, so keep their captured origin/recovery geometry until the
          // real dragend rather than treating leave as a normal mouseup. The pointer button
          // state on a Konva mouseleave is not reliable across browsers or synthetic input, so
          // the captured gesture itself is the authority here. A click-only capture is cleaned
          // up by the window mouseup listener below.
          if (directGesture.current) {
            cancelDirectManipulation()
            return
          }
          const draft = drafting.current
          if (draft && draft.id !== 'crop' && draft.id !== 'cutOut') return
          if (bodyDrag.current || multiDrag.current) return
          onStageMouseUp()
        }}
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
          {/* Annotation pixels may occupy automatic workspace outside the source capture. */}
          <ShotFrame layout={layout} canvas={doc.canvas}>
            <Group
              ref={shapesGroupRef}
              x={shapeOrigin}
              y={-layout.cropY}
              onDragStart={beginShapeTransform}
              onDragMove={onDragMove}
              onDragEnd={finishShapeTransform}
            >
              {sorted.map((shape) => (
                <ShapeNode
                  key={shape.id}
                  shape={shape}
                  ctx={shapeCtx}
                  draggable={tool === 'select'}
                  onSelect={onSelectShape}
                  onBodyPointerDown={captureMultiDrag}
                  onChange={commitShapeChange}
                  onDragStart={beginShapeDrag}
                  onEditText={setEditingText}
                  directLineLike={selectedDirectShape?.id === shape.id}
                />
              ))}
            </Group>
          </ShotFrame>

          {selectedDirectShape && (
            <ShotFrame layout={layout} canvas={doc.canvas}>
              <Group x={shapeOrigin} y={-layout.cropY}>
                <LineControls
                  shape={selectedDirectShape}
                  zoom={zoom}
                  x={0}
                  y={0}
                  onBegin={(gesture) => beginDirectManipulation(selectedDirectShape.id, gesture)}
                  onEndpointMove={(endpoint, point, shift) =>
                    updateDirectEndpoint(selectedDirectShape.id, endpoint, point, shift)
                  }
                  onCurveMove={(point) => updateDirectCurve(selectedDirectShape.id, point)}
                  onEnd={endDirectManipulation}
                />
              </Group>
            </ShotFrame>
          )}

          <Transformer
            ref={transformerRef}
            rotateEnabled
            keepRatio={false}
            ignoreStroke
            rotateLineVisible={false}
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
            onTransformStart={beginTransformerTransform}
            onTransformEnd={commitTransform}
          />

          <Group
            ref={rotateIconGroupRef}
            listening={false}
            visible={tool === 'select' && selectedIds.length > 0 && !selectedDirectShape}
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

      {toolbarState.box && isFloatingToolbarVisible(toolbarState) && (
        <FloatingToolbar
          box={toolbarState.box}
          // Keep the actual viewport width as a fallback until the stage and viewport
          // rectangles are available. Normal renders carry nonzero scroll-relative bounds.
          stageWidth={Math.max(1, containerWidth)}
        />
      )}

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

const QUICK_COLOURS = [
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#4f8cff',
  '#af52de',
  '#ffffff',
  '#000000'
]

/**
 * The controls you reach for constantly, put where the cursor already is.
 * Anything deeper stays in the sidebar.
 */
function FloatingToolbar({
  box,
  stageWidth
}: {
  box: FloatingToolbarBox
  stageWidth: number
}): React.ReactElement {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [toolbarWidth, setToolbarWidth] = useState(0)
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

  useLayoutEffect(() => {
    const element = toolbarRef.current
    if (!element) return
    const measure = () => {
      const next = element.getBoundingClientRect().width
      setToolbarWidth((current) => (current === next ? current : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const bounds =
    Number.isFinite(box.visibleLeft) && Number.isFinite(box.visibleRight)
      ? { left: box.visibleLeft as number, right: box.visibleRight as number }
      : { left: 0, right: stageWidth }

  const left =
    toolbarWidth > 0
      ? clampToolbarCenter(
          box.left + box.width / 2,
          toolbarWidth,
          bounds,
          FLOATING_TOOLBAR_EDGE_PADDING
        )
      : clampToolbarCenter(box.left + box.width / 2, 0, bounds, FLOATING_TOOLBAR_EDGE_PADDING)

  return (
    <div
      ref={toolbarRef}
      className="float-bar"
      style={{
        left,
        top: floatingToolbarTop(box.top, box.height),
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
  const endPath = cutOutEdgePath(
    draft.axis,
    length,
    draft.start + draft.size,
    draft.edge,
    amplitude
  )

  return (
    <Group x={layout.shotX} y={layout.shotY + layout.frameHeight} listening={false}>
      <Rect
        x={draft.axis === 'vertical' ? draft.start : 0}
        y={draft.axis === 'horizontal' ? draft.start : 0}
        width={draft.axis === 'vertical' ? draft.size : width}
        height={draft.axis === 'horizontal' ? draft.size : height}
        fill="#000000"
        opacity={0.48}
      />
      <Line
        points={startPath}
        stroke="#ffffff"
        strokeWidth={2}
        dash={[7, 5]}
        shadowColor="#000"
        shadowBlur={3}
        shadowOpacity={0.6}
      />
      <Line
        points={endPath}
        stroke="#ffffff"
        strokeWidth={2}
        dash={[7, 5]}
        shadowColor="#000"
        shadowBlur={3}
        shadowOpacity={0.6}
      />
    </Group>
  )
}

export type { ClipDocument, TextShape, ToolId }
