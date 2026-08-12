import type { ClipDocument, ToolId } from '@shared/types'
import { computeLayout } from './layout'
import {
  effectiveLinePoints,
  interactiveRecoveryRects,
  lineCurvePoint,
  lineEndpoint,
  type DragRect,
  type Point
} from './canvas/geometry'
import { useEditor } from './store'

export interface EditorSelfTestSnapshot {
  selectedIds: string[]
  dirty: boolean
  past: number
  future: number
  tool: string
  zoom: number
  doc: Omit<ClipDocument, 'image'> | null
  toolbarVisible: boolean
  toolbarRect: { left: number; top: number; width: number; height: number } | null
  stageRect: { left: number; top: number; width: number; height: number } | null
  viewportRect: { left: number; top: number; width: number; height: number } | null
  viewportScroll: { left: number; top: number }
  windowSize: { width: number; height: number }
}

interface EditorSelfTestBridge {
  snapshot: () => EditorSelfTestSnapshot
  point: (point: Point) => Point | null
  linePoint: (id: string, part: 'start' | 'end' | 'curve') => Point | null
  recovery: (id: string) => DragRect[]
  setTool: (tool: ToolId) => void
  setZoom: (zoom: number) => void
  render: () => Promise<{ dataUrl: string; selectedIds: string[] } | null>
  transformerRotateLineVisible: () => boolean | null
  rotateHandle: () => Point | null
}

declare global {
  interface Window {
    __CLIPTHAT_EDITOR_SELF_TEST__?: EditorSelfTestBridge
  }
}

function rectOf(element: Element | null): EditorSelfTestSnapshot['stageRect'] {
  if (!(element instanceof HTMLElement) && !(element instanceof HTMLCanvasElement)) return null
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function stateDocument(): Omit<ClipDocument, 'image'> | null {
  const doc = useEditor.getState().doc
  if (!doc) return null
  const { image: _image, ...withoutImage } = doc
  return withoutImage
}

function stagePoint(point: Point): Point | null {
  const state = useEditor.getState()
  const doc = state.doc
  const canvas = document.querySelector('.viewport canvas')
  if (!doc || !canvas) return null
  const layout = computeLayout(doc)
  const rect = canvas.getBoundingClientRect()
  return {
    x: rect.left + state.zoom * (layout.shotX + point.x - layout.cropX),
    y: rect.top + state.zoom * (layout.shotY + layout.frameHeight + point.y - layout.cropY)
  }
}

function linePointFor(id: string, part: 'start' | 'end' | 'curve'): Point | null {
  const shape = useEditor.getState().doc?.shapes.find((candidate) => candidate.id === id)
  if (
    !shape ||
    !('points' in shape) ||
    (shape.type !== 'arrow' && shape.type !== 'line' && shape.type !== 'measure')
  )
    return null
  const points = effectiveLinePoints(shape)
  if (part === 'curve')
    return shape.curve === undefined ? null : stagePoint(lineCurvePoint(points, shape.curve))
  return stagePoint(lineEndpoint(points, part))
}

function recoveryRectsFor(id: string): DragRect[] {
  const state = useEditor.getState()
  const shape = state.doc?.shapes.find((candidate) => candidate.id === id)
  return shape ? interactiveRecoveryRects(shape, state.zoom) : []
}

function snapshot(): EditorSelfTestSnapshot {
  const toolbar = document.querySelector('.float-bar')
  const viewport = document.querySelector('.viewport')
  const scroll = viewport instanceof HTMLElement ? viewport : null
  return {
    selectedIds: [...useEditor.getState().selectedIds],
    dirty: useEditor.getState().dirty,
    past: useEditor.getState().past.length,
    future: useEditor.getState().future.length,
    tool: useEditor.getState().tool,
    zoom: useEditor.getState().zoom,
    doc: stateDocument(),
    toolbarVisible: Boolean(toolbar),
    toolbarRect: rectOf(toolbar),
    stageRect: rectOf(document.querySelector('.viewport canvas')),
    viewportRect: rectOf(viewport),
    viewportScroll: { left: scroll?.scrollLeft ?? 0, top: scroll?.scrollTop ?? 0 },
    windowSize: { width: window.innerWidth, height: window.innerHeight }
  }
}

/**
 * Install only for an editor opened with the `#self-test` hash. The bridge exposes document
 * state without the screenshot payload and maps fixture points through the live Konva layout;
 * pointer input still enters through the real Stage and Shape handlers.
 */
export function installEditorSelfTestBridge(
  render: () => Promise<string | null>,
  transformerRotateLineVisible: () => boolean | null = () => null,
  rotateHandle: () => Point | null = () => null
): (() => void) | undefined {
  if (window.location.hash !== '#self-test') return undefined

  const bridge: EditorSelfTestBridge = {
    snapshot,
    point: stagePoint,
    linePoint: linePointFor,
    recovery: recoveryRectsFor,
    setTool: (tool) => useEditor.getState().setTool(tool),
    setZoom: (zoom) => useEditor.getState().setZoom(zoom, false),
    render: async () => {
      const dataUrl = await render()
      return dataUrl ? { dataUrl, selectedIds: [...useEditor.getState().selectedIds] } : null
    },
    transformerRotateLineVisible,
    rotateHandle
  }
  window.__CLIPTHAT_EDITOR_SELF_TEST__ = bridge
  return () => {
    if (window.__CLIPTHAT_EDITOR_SELF_TEST__ === bridge) delete window.__CLIPTHAT_EDITOR_SELF_TEST__
  }
}
