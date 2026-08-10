import { create } from 'zustand'
import type {
  BoxShape,
  CanvasStyle,
  ClipDocument,
  CutOutEdge,
  CutOutOperation,
  CropRect,
  OcrResult,
  Shape,
  StepShape,
  TextShape,
  ToolId
} from '@shared/types'
import { DEFAULT_CANVAS } from '@shared/defaults'
import { isValidCutOutSelection, transformShapesForCutOut } from '@shared/cut-out'

/** The slice of a document that undo/redo restores. */
interface Snapshot {
  shapes: Shape[]
  crop: CropRect
  cutOuts?: CutOutOperation[]
  canvas: CanvasStyle
  title: string
}

export interface DrawStyle {
  color: string
  strokeWidth: number
  fill: string
  fillEnabled: boolean
  fontSize: number
  fontFamily: string
  dashed: boolean
  shadow: boolean
  cornerRadius: number
  intensity: number
  stepShape: 'circle' | 'square' | 'diamond'
  arrowCurve: number
  opacity: number
}

interface EditorState {
  doc: ClipDocument | null
  /** Library id when this document came from (or was saved to) the library. */
  libraryId: string | null
  /** External still path last chosen for the current document, when one exists. */
  exportPath: string | null
  tool: ToolId
  selectedIds: string[]
  editingTextId: string | null
  style: DrawStyle
  zoom: number
  autoFit: boolean
  dirty: boolean
  past: Snapshot[]
  future: Snapshot[]
  /** Pending crop rectangle while the crop tool is active. */
  cropDraft: CropRect | null
  /** Pending band selection while the Cut Out tool is active. */
  cutOutDraft: CutOutOperation | null
  cutOutAxis: 'horizontal' | 'vertical'
  cutOutEdge: CutOutEdge
  /** Derived image generation is asynchronous; exports wait for it to settle. */
  cutOutRendering: boolean
  ocrBusy: boolean
  /** Word boxes from the last OCR pass — powers Live Text and the context panel. */
  ocr: OcrResult | null
  /** Selectable text overlay, macOS Live Text style. */
  liveTextOn: boolean
  /** Inclusive word-index range currently selected in the Live Text layer. */
  liveSelection: [number, number] | null
  /** Right-hand panel mode. */
  panel: 'inspect' | 'context' | 'layers'

  setDoc: (doc: ClipDocument, libraryId?: string | null, exportPath?: string | null) => void
  setExportPath: (exportPath: string | null) => void
  setTool: (tool: ToolId) => void
  setStyle: (patch: Partial<DrawStyle>) => void
  select: (ids: string[]) => void
  setEditingText: (id: string | null) => void
  setZoom: (zoom: number, autoFit?: boolean) => void
  setOcrBusy: (busy: boolean) => void
  setOcr: (result: OcrResult | null) => void
  setLiveText: (on: boolean) => void
  setLiveSelection: (range: [number, number] | null) => void
  setPanel: (panel: 'inspect' | 'context' | 'layers') => void

  /** Snapshot the current state so the next mutation can be undone. */
  begin: () => void
  /** Close a transaction and remove its history entry when nothing changed. */
  end: () => void
  addShape: (shape: Shape, options?: { history?: boolean }) => void
  updateShape: (id: string, patch: Partial<Shape>) => void
  updateShapes: (patch: Record<string, Partial<Shape>>) => void
  removeShapes: (ids: string[]) => void
  reorder: (id: string, direction: 'front' | 'back' | 'forward' | 'backward') => void
  duplicateSelected: () => void

  setCanvas: (patch: Partial<CanvasStyle>) => void
  setCropDraft: (crop: CropRect | null) => void
  applyCrop: (crop: CropRect) => void
  resetCrop: () => void
  setCutOutDraft: (cutOut: CutOutOperation | null) => void
  setCutOutOptions: (patch: { axis?: 'horizontal' | 'vertical'; edge?: CutOutEdge }) => void
  applyCutOut: (cutOut: CutOutOperation) => void
  setCutOutRendering: (rendering: boolean) => void
  setTitle: (title: string) => void
  setOcrText: (text: string) => void

  undo: () => void
  redo: () => void
  markSaved: () => void

  nextStepIndex: () => number
  contentSize: () => { width: number; height: number }
  selectedShapes: () => Shape[]
}

const MAX_HISTORY = 100

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const snapshot = (doc: ClipDocument): Snapshot => ({
  shapes: clone(doc.shapes),
  crop: { ...doc.crop },
  cutOuts: doc.cutOuts ? clone(doc.cutOuts) : undefined,
  canvas: { ...doc.canvas },
  title: doc.title
})

const sameSnapshot = (a: Snapshot, b: Snapshot): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  libraryId: null,
  exportPath: null,
  tool: 'select',
  selectedIds: [],
  editingTextId: null,
  zoom: 1,
  autoFit: true,
  dirty: false,
  past: [],
  future: [],
  cropDraft: null,
  cutOutDraft: null,
  cutOutAxis: 'horizontal',
  cutOutEdge: 'straight',
  cutOutRendering: false,
  ocrBusy: false,
  ocr: null,
  liveTextOn: false,
  liveSelection: null,
  panel: 'inspect',
  style: {
    color: '#ff3b30',
    strokeWidth: 4,
    fill: '#ff3b30',
    fillEnabled: false,
    fontSize: 28,
    fontFamily: 'Inter, system-ui, sans-serif',
    dashed: false,
    shadow: true,
    cornerRadius: 4,
    intensity: 12,
    stepShape: 'circle',
    arrowCurve: 0,
    opacity: 1
  },

  setDoc: (doc, libraryId = null, exportPath = null) =>
    set({
      doc: {
        ...doc,
        canvas: {
          ...DEFAULT_CANVAS,
          ...doc.canvas,
          // Version-1 documents without the marker used the old Inspector labels:
          // horizontal was stored in tiltY and vertical in tiltX.
          tiltSemantics: doc.canvas.tiltSemantics ?? 'legacy'
        }
      },
      libraryId,
      exportPath: exportPath ?? doc.exportPath ?? null,
      past: [],
      future: [],
      selectedIds: [],
      editingTextId: null,
      cropDraft: null,
      cutOutDraft: null,
      cutOutRendering: false,
      ocr: null,
      liveTextOn: false,
      liveSelection: null,
      panel: 'inspect',
      zoom: 1,
      autoFit: true,
      dirty: false
    }),

  setExportPath: (exportPath) =>
    set((s) =>
      s.doc
        ? {
            doc: { ...s.doc, exportPath: exportPath ?? undefined, updatedAt: Date.now() },
            exportPath,
            dirty: true
          }
        : s
    ),

  setTool: (tool) =>
    set((s) => {
      // Crop coordinates are source-image coordinates, while Cut Out works in its
      // derived output space. Keep the two operations from becoming a silent no-op
      // until a composed crop model exists.
      const nextTool = tool === 'crop' && s.doc?.cutOuts?.length ? 'select' : tool
      return {
        tool: nextTool,
        // Leaving the crop tool abandons an uncommitted crop rectangle.
        cropDraft: nextTool === 'crop' ? s.cropDraft : null,
        cutOutDraft: nextTool === 'cutOut' ? s.cutOutDraft : null,
        selectedIds: nextTool === 'select' ? s.selectedIds : [],
        editingTextId: null
      }
    }),

  setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),
  select: (ids) => set({ selectedIds: ids }),
  setEditingText: (id) => set({ editingTextId: id }),
  setZoom: (zoom, autoFit = false) => set({ zoom: Math.max(0.05, Math.min(8, zoom)), autoFit }),
  setOcrBusy: (ocrBusy) => set({ ocrBusy }),
  setOcr: (ocr) => set({ ocr }),
  setLiveText: (liveTextOn) => set({ liveTextOn, liveSelection: null, selectedIds: [] }),
  setLiveSelection: (liveSelection) => set({ liveSelection }),
  setPanel: (panel) => set({ panel }),

  begin: () => {
    const { doc, past } = get()
    if (!doc) return
    const current = snapshot(doc)
    if (past.length > 0 && sameSnapshot(past[past.length - 1], current)) return
    set({
      past: [...past.slice(-(MAX_HISTORY - 1)), current]
    })
  },

  end: () => {
    const { doc, past } = get()
    if (!doc || past.length === 0) return
    if (sameSnapshot(past[past.length - 1], snapshot(doc))) {
      set({ past: past.slice(0, -1) })
    }
  },

  addShape: (shape, options) =>
    set((s) => {
      if (!s.doc) return s
      const history = options?.history !== false
      const past = history ? [...s.past.slice(-(MAX_HISTORY - 1)), snapshot(s.doc)] : s.past
      return {
        doc: { ...s.doc, shapes: [...s.doc.shapes, shape], updatedAt: Date.now() },
        past,
        future: [],
        dirty: true,
        selectedIds: [shape.id]
      }
    }),

  updateShape: (id, patch) =>
    set((s) => {
      if (!s.doc) return s
      const geometryChanged = Object.keys(patch).some((key) =>
        ['x', 'y', 'width', 'height', 'points', 'rotation', 'tail'].includes(key)
      )
      const shapes = s.doc.shapes.map((sh) => {
        if (sh.id !== id) return sh
        const next = { ...sh, ...patch } as Shape
        if (geometryChanged) delete next.clipRects
        return next
      })
      return {
        doc: {
          ...s.doc,
          shapes,
          updatedAt: Date.now()
        },
        future: [],
        dirty: true
      }
    }),

  updateShapes: (patch) =>
    set((s) => {
      if (!s.doc) return s
      const geometryChanged = Object.values(patch).some((value) =>
        Object.keys(value).some((key) => ['x', 'y', 'width', 'height', 'points', 'rotation', 'tail'].includes(key))
      )
      return {
        doc: {
          ...s.doc,
          shapes: s.doc.shapes.map((sh) =>
            patch[sh.id]
              ? (() => {
                  const next = { ...sh, ...patch[sh.id] } as Shape
                  if (geometryChanged) delete next.clipRects
                  return next
                })()
              : sh
          ),
          updatedAt: Date.now()
        },
        future: [],
        dirty: true
      }
    }),

  removeShapes: (ids) =>
    set((s) => {
      if (!s.doc || ids.length === 0) return s
      const gone = new Set(ids)
      return {
        doc: {
          ...s.doc,
          shapes: s.doc.shapes.filter((sh) => !gone.has(sh.id)),
          updatedAt: Date.now()
        },
        past: [...s.past.slice(-(MAX_HISTORY - 1)), snapshot(s.doc)],
        future: [],
        selectedIds: s.selectedIds.filter((id) => !gone.has(id)),
        dirty: true
      }
    }),

  reorder: (id, direction) =>
    set((s) => {
      if (!s.doc) return s
      const shapes = [...s.doc.shapes].sort((a, b) => a.z - b.z)
      const index = shapes.findIndex((sh) => sh.id === id)
      if (index === -1) return s

      const [item] = shapes.splice(index, 1)
      const target =
        direction === 'front'
          ? shapes.length
          : direction === 'back'
            ? 0
            : direction === 'forward'
              ? Math.min(shapes.length, index + 1)
              : Math.max(0, index - 1)
      shapes.splice(target, 0, item)

      return {
        doc: {
          ...s.doc,
          shapes: shapes.map((sh, i) => ({ ...sh, z: i })),
          updatedAt: Date.now()
        },
        past: [...s.past.slice(-(MAX_HISTORY - 1)), snapshot(s.doc)],
        future: [],
        dirty: true
      }
    }),

  duplicateSelected: () =>
    set((s) => {
      if (!s.doc || s.selectedIds.length === 0) return s
      const selected = new Set(s.selectedIds)
      const maxZ = s.doc.shapes.reduce((m, sh) => Math.max(m, sh.z), 0)
      const clones: Shape[] = []
      s.doc.shapes
        .filter((sh) => selected.has(sh.id))
        .forEach((sh, i) => {
          const clone = { ...sh, id: crypto.randomUUID(), z: maxZ + 1 + i } as Shape
          // Offset the copy so it's obviously a second object.
          if ('x' in clone && 'y' in clone) {
            ;(clone as BoxShape).x += 16
            ;(clone as BoxShape).y += 16
          } else if ('points' in clone) {
            clone.points = clone.points.map((p, idx) => p + (idx % 2 === 0 ? 16 : 16))
          }
          clones.push(clone)
        })
      return {
        doc: { ...s.doc, shapes: [...s.doc.shapes, ...clones], updatedAt: Date.now() },
        past: [...s.past.slice(-(MAX_HISTORY - 1)), snapshot(s.doc)],
        future: [],
        selectedIds: clones.map((c) => c.id),
        dirty: true
      }
    }),

  setCanvas: (patch) =>
    set((s) =>
      s.doc
        ? {
            doc: { ...s.doc, canvas: { ...s.doc.canvas, ...patch }, updatedAt: Date.now() },
            future: [],
            dirty: true
          }
        : s
    ),

  setCropDraft: (cropDraft) => set({ cropDraft }),

  applyCrop: (crop) =>
    set((s) => {
      if (!s.doc || s.doc.cutOuts?.length) return s
      return {
        doc: { ...s.doc, crop: { ...crop, enabled: true }, updatedAt: Date.now() },
        past: [...s.past.slice(-(MAX_HISTORY - 1)), snapshot(s.doc)],
        future: [],
        cropDraft: null,
        tool: 'select',
        dirty: true
      }
    }),

  resetCrop: () =>
    set((s) => {
      if (!s.doc || s.doc.cutOuts?.length) return s
      return {
        doc: {
          ...s.doc,
          crop: { enabled: false, x: 0, y: 0, width: s.doc.imageWidth, height: s.doc.imageHeight },
          updatedAt: Date.now()
        },
        past: [...s.past.slice(-(MAX_HISTORY - 1)), snapshot(s.doc)],
        future: [],
        cropDraft: null,
        dirty: true
      }
    }),

  setCutOutDraft: (cutOutDraft) => set({ cutOutDraft }),

  setCutOutOptions: (patch) =>
    set((s) => ({
      cutOutAxis: patch.axis ?? s.cutOutAxis,
      cutOutEdge: patch.edge ?? s.cutOutEdge,
      cutOutDraft: s.cutOutDraft
        ? {
            ...s.cutOutDraft,
            axis: patch.axis ?? s.cutOutDraft.axis,
            edge: patch.edge ?? s.cutOutDraft.edge
          }
        : s.cutOutDraft
    })),

  applyCutOut: (cutOut) =>
    set((s) => {
      if (!s.doc || !isValidCutOutSelection(cutOut)) return s
      const current = s.doc.cutOuts ?? []
      const shapes = transformShapesForCutOut(s.doc.shapes, cutOut)
      return {
        doc: {
          ...s.doc,
          cutOuts: [...current, clone(cutOut)],
          shapes,
          updatedAt: Date.now()
        },
        past: [...s.past.slice(-(MAX_HISTORY - 1)), snapshot(s.doc)],
        future: [],
        cutOutDraft: null,
        tool: 'select',
        selectedIds: [],
        dirty: true,
        cutOutRendering: true
      }
    }),

  setCutOutRendering: (cutOutRendering) => set({ cutOutRendering }),

  setTitle: (title) =>
    set((s) =>
      s.doc
        ? { doc: { ...s.doc, title, updatedAt: Date.now() }, future: [], dirty: true }
        : s
    ),
  setOcrText: (ocrText) => set((s) => (s.doc ? { doc: { ...s.doc, ocrText } } : s)),

  undo: () =>
    set((s) => {
      if (!s.doc || s.past.length === 0) return s
      const previous = s.past[s.past.length - 1]
      const cutOutChanged = JSON.stringify(s.doc.cutOuts) !== JSON.stringify(previous.cutOuts)
      return {
        past: s.past.slice(0, -1),
        future: [...s.future, snapshot(s.doc)],
        doc: { ...s.doc, ...previous, cutOuts: previous.cutOuts ? clone(previous.cutOuts) : undefined, updatedAt: Date.now() },
        selectedIds: [],
        editingTextId: null,
        dirty: true,
        cutOutRendering: cutOutChanged
      }
    }),

  redo: () =>
    set((s) => {
      if (!s.doc || s.future.length === 0) return s
      const next = s.future[s.future.length - 1]
      const cutOutChanged = JSON.stringify(s.doc.cutOuts) !== JSON.stringify(next.cutOuts)
      return {
        future: s.future.slice(0, -1),
        past: [...s.past, snapshot(s.doc)],
        doc: { ...s.doc, ...next, cutOuts: next.cutOuts ? clone(next.cutOuts) : undefined, updatedAt: Date.now() },
        selectedIds: [],
        editingTextId: null,
        dirty: true,
        cutOutRendering: cutOutChanged
      }
    }),

  markSaved: () => set({ dirty: false }),

  nextStepIndex: () => {
    const doc = get().doc
    if (!doc) return 1
    const steps = doc.shapes.filter((s): s is StepShape => s.type === 'step')
    return steps.reduce((max, s) => Math.max(max, s.index), 0) + 1
  },

  contentSize: () => {
    const doc = get().doc
    if (!doc) return { width: 0, height: 0 }
    return doc.crop.enabled
      ? { width: doc.crop.width, height: doc.crop.height }
      : { width: doc.imageWidth, height: doc.imageHeight }
  },

  selectedShapes: () => {
    const { doc, selectedIds } = get()
    if (!doc) return []
    const ids = new Set(selectedIds)
    return doc.shapes.filter((s) => ids.has(s.id))
  }
}))

/* ------------------------------------------------------------------ *
 * Shape factories
 * ------------------------------------------------------------------ */

const uid = () => crypto.randomUUID()

export function createShape(
  tool: ToolId,
  start: { x: number; y: number },
  style: DrawStyle,
  z: number,
  stepIndex = 1
): Shape | null {
  const base = { id: uid(), z, opacity: style.opacity }
  const strokeStyle = {
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    dash: style.dashed ? [style.strokeWidth * 3, style.strokeWidth * 2] : undefined
  }
  const shadow = style.shadow
    ? { shadow: true, shadowColor: '#000000', shadowBlur: 6, shadowOffsetX: 0, shadowOffsetY: 2 }
    : {}

  switch (tool) {
    case 'arrow':
      return {
        ...base,
        ...strokeStyle,
        ...shadow,
        type: 'arrow',
        points: [start.x, start.y, start.x, start.y],
        endHead: true,
        headScale: 3.2,
        curve: style.arrowCurve
      }
    case 'line':
      return { ...base, ...strokeStyle, ...shadow, type: 'line', points: [start.x, start.y, start.x, start.y] }
    case 'measure':
      return {
        ...base,
        ...strokeStyle,
        ...shadow,
        type: 'measure',
        points: [start.x, start.y, start.x, start.y],
        startHead: true,
        endHead: true,
        headScale: 2.4
      }
    case 'pen':
      return { ...base, ...strokeStyle, type: 'pen', points: [start.x, start.y] }
    case 'highlighter':
      return {
        ...base,
        type: 'highlighter',
        stroke: style.color,
        strokeWidth: Math.max(12, style.strokeWidth * 5),
        points: [start.x, start.y],
        opacity: 0.4
      }
    case 'rect':
    case 'ellipse':
      return {
        ...base,
        ...strokeStyle,
        ...shadow,
        type: tool,
        x: start.x,
        y: start.y,
        width: 0,
        height: 0,
        cornerRadius: tool === 'rect' ? style.cornerRadius : 0,
        fill: style.fillEnabled ? style.fill : undefined,
        fillOpacity: 0.28
      }
    case 'blur':
    case 'pixelate':
    case 'redact':
    case 'spotlight':
    case 'magnify':
      return {
        ...base,
        type: tool,
        x: start.x,
        y: start.y,
        width: 0,
        height: 0,
        stroke: tool === 'magnify' ? style.color : 'transparent',
        strokeWidth: tool === 'magnify' ? Math.max(2, style.strokeWidth / 2) : 0,
        fill: tool === 'redact' ? '#000000' : undefined,
        intensity: tool === 'magnify' ? 2 : style.intensity,
        dim: 0.62,
        cornerRadius: tool === 'redact' ? 2 : 0
      }
    case 'text':
      return {
        ...base,
        type: 'text',
        x: start.x,
        y: start.y,
        width: 320,
        text: '',
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        color: style.color,
        align: 'left',
        padding: 4,
        ...shadow
      }
    case 'callout':
      return {
        ...base,
        type: 'callout',
        x: start.x,
        y: start.y,
        width: 260,
        height: 84,
        text: '',
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        color: '#ffffff',
        background: style.color,
        padding: 12,
        cornerRadius: 10,
        align: 'left',
        tail: { x: 40, y: 120 },
        ...shadow
      }
    case 'step':
      return {
        ...base,
        type: 'step',
        x: start.x,
        y: start.y,
        radius: Math.max(16, style.fontSize * 0.9),
        index: stepIndex,
        fill: style.color,
        color: '#ffffff',
        fontSize: style.fontSize,
        shape: style.stepShape,
        ...shadow
      } as StepShape
    default:
      return null
  }
}

/** Shapes that are defined by dragging a box. */
export const BOX_TOOLS: ToolId[] = ['rect', 'ellipse', 'blur', 'pixelate', 'redact', 'spotlight', 'magnify']
export const LINE_TOOLS: ToolId[] = ['arrow', 'line', 'measure']
export const FREEHAND_TOOLS: ToolId[] = ['pen', 'highlighter']
export const CLICK_TOOLS: ToolId[] = ['step']
export const TEXT_TOOLS: ToolId[] = ['text', 'callout']

export function isTextShape(shape: Shape): shape is TextShape {
  return shape.type === 'text' || shape.type === 'callout'
}
