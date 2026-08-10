import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const cutOut = await load('cutOut')
const { renderCutOutImage } = await load('cutOutImage')
const { useEditor } = await load('editorStore')
const validation = await load('ipcValidation')
const { computeLayout } = await load('layout')

const operation = (overrides = {}) => ({
  source: { x: 0, y: 0, width: 100, height: 100 },
  axis: 'horizontal',
  start: 40,
  size: 20,
  edge: 'straight',
  ...overrides
})

function canvas() {
  return {
    padding: 0,
    background: 'none',
    backgroundColor: '#000000',
    gradientFrom: '#000000',
    gradientTo: '#ffffff',
    gradientAngle: 0,
    radius: 0,
    shadowBlur: 0,
    shadowOpacity: 0,
    shadowOffsetY: 0,
    borderWidth: 0,
    borderColor: '#000000',
    frame: 'none',
    aspect: 'auto',
    tiltX: 0,
    tiltY: 0
  }
}

function documentWith(shapes = [], extra = {}) {
  return {
    version: 1,
    id: 'cut-out-doc',
    title: 'Cut Out',
    createdAt: 1,
    updatedAt: 1,
    image: 'data:image/png;base64,AAAA',
    imageWidth: 100,
    imageHeight: 100,
    scaleFactor: 1,
    crop: { enabled: false, x: 0, y: 0, width: 100, height: 100 },
    shapes,
    canvas: canvas(),
    ...extra
  }
}

test('plans horizontal and vertical output slices without retaining the removed band', () => {
  assert.deepEqual(cutOut.cutOutContentSize({ width: 100, height: 100 }, operation()), { width: 100, height: 80 })
  assert.deepEqual(cutOut.cutOutImageSegments(operation()), [
    { sx: 0, sy: 0, width: 100, height: 40, dx: 0, dy: 0 },
    { sx: 0, sy: 60, width: 100, height: 40, dx: 0, dy: 40 }
  ])

  const vertical = operation({ axis: 'vertical', start: 25, size: 15 })
  assert.deepEqual(cutOut.cutOutContentSize({ width: 100, height: 100 }, vertical), { width: 85, height: 100 })
  assert.deepEqual(cutOut.cutOutImageSegments(vertical), [
    { sx: 0, sy: 0, width: 25, height: 100, dx: 0, dy: 0 },
    { sx: 40, sy: 0, width: 60, height: 100, dx: 25, dy: 0 }
  ])
})

test('edge presets produce deterministic seam paths in both orientations', () => {
  for (const edge of ['straight', 'zigzag', 'wave', 'triangle']) {
    const horizontal = cutOut.cutOutEdgePath('horizontal', 100, 40, edge, 6)
    const vertical = cutOut.cutOutEdgePath('vertical', 100, 40, edge, 6)
    assert.equal(horizontal[0], 0)
    assert.equal(horizontal[1], 40)
    assert.equal(horizontal.at(-2), 100)
    assert.equal(horizontal.at(-1), 40)
    assert.equal(vertical[0], 40)
    assert.equal(vertical[1], 0)
    assert.equal(vertical.at(-2), 40)
    assert.equal(vertical.at(-1), 100)
    if (edge !== 'straight') assert.ok(horizontal.length > 4)
  }
})

test('flatten renderer uses the same output slices and dimensions as the editor preview', () => {
  const previousDocument = globalThis.document
  const draws = []
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        drawImage: (...args) => draws.push(args),
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {}
      }
    },
    toDataURL() {
      return 'data:image/png;base64,flattened'
    }
  }
  globalThis.document = { createElement: () => canvas }
  try {
    const sourceImage = { naturalWidth: 100, naturalHeight: 100 }
    const vertical = operation({ axis: 'vertical', start: 25, size: 15 })
    assert.equal(renderCutOutImage(sourceImage, vertical), 'data:image/png;base64,flattened')
    assert.deepEqual({ width: canvas.width, height: canvas.height }, { width: 85, height: 100 })
    assert.deepEqual(draws, [
      [sourceImage, 0, 0, 25, 100, 0, 0, 25, 100],
      [sourceImage, 40, 0, 60, 100, 25, 0, 60, 100]
    ])
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('crossing line and box annotations remain editable as split output-space shapes', () => {
  const shapes = [
    {
      id: 'arrow-1',
      type: 'arrow',
      z: 1,
      stroke: '#f00',
      strokeWidth: 4,
      points: [10, 20, 10, 80],
      endHead: true
    },
    {
      id: 'rect-1',
      type: 'rect',
      z: 2,
      x: 20,
      y: 30,
      width: 40,
      height: 40,
      stroke: '#0f0',
      strokeWidth: 2
    },
    {
      id: 'text-1',
      type: 'text',
      z: 3,
      x: 8,
      y: 30,
      width: 60,
      height: 40,
      text: 'Keep me editable',
      fontFamily: 'system-ui',
      fontSize: 16,
      color: '#fff'
    }
  ]
  const transformed = cutOut.transformShapesForCutOut(shapes, operation())

  const arrows = transformed.filter((shape) => shape.type === 'arrow')
  assert.equal(arrows.length, 2)
  assert.deepEqual(arrows[0].points, [10, 20, 10, 40])
  assert.deepEqual(arrows[1].points, [10, 40, 10, 60])
  assert.equal(arrows[0].endHead, false)
  assert.equal(arrows[1].endHead, true)

  const rects = transformed.filter((shape) => shape.type === 'rect')
  assert.equal(rects.length, 2)
  assert.deepEqual(
    rects.map(({ x, y, width, height }) => ({ x, y, width, height })),
    [
      { x: 20, y: 30, width: 40, height: 10 },
      { x: 20, y: 40, width: 40, height: 10 }
    ]
  )

  const text = transformed.find((shape) => shape.type === 'text')
  assert.equal(text.hidden, undefined)
  assert.equal(text.clipRects.length, 2)
  assert.equal(text.text, 'Keep me editable')
})

test('annotations wholly inside the removed band are retained, hidden, and recoverable from Layers', () => {
  const [shape] = cutOut.transformShapesForCutOut([
    {
      id: 'inside',
      type: 'rect',
      z: 1,
      x: 20,
      y: 45,
      width: 30,
      height: 10,
      stroke: '#fff',
      strokeWidth: 2
    }
  ], operation())
  assert.equal(shape.id, 'inside')
  assert.equal(shape.hidden, true)
  assert.ok(shape.width >= 1)
})

test('Cut Out is one undoable and redoable document transaction and survives project serialization', () => {
  const state = useEditor.getState()
  state.setDoc(documentWith([
    { id: 'line-1', type: 'line', z: 1, stroke: '#fff', strokeWidth: 2, points: [10, 10, 10, 90] }
  ]))
  state.applyCutOut(operation({ edge: 'wave' }))

  assert.equal(useEditor.getState().doc.cutOuts.length, 1)
  assert.equal(useEditor.getState().doc.shapes.length, 2)
  assert.equal(useEditor.getState().past.length, 1)
  assert.equal(computeLayout(useEditor.getState().doc).contentHeight, 80)

  const serialized = JSON.parse(JSON.stringify(useEditor.getState().doc))
  assert.equal(validation.clipDocument(serialized).cutOuts[0].edge, 'wave')

  state.undo()
  assert.equal(useEditor.getState().doc.cutOuts, undefined)
  assert.equal(useEditor.getState().doc.shapes.length, 1)
  state.redo()
  assert.equal(useEditor.getState().doc.cutOuts.length, 1)
  assert.equal(useEditor.getState().doc.shapes.length, 2)
})

test('strict project validation accepts Cut Out operations and rejects unsafe geometry or clip data', () => {
  assert.equal(validation.clipDocument(documentWith([], { cutOuts: [operation()] })).cutOuts.length, 1)
  assert.throws(
    () => validation.clipDocument(documentWith([], { cutOuts: [operation({ edge: 'circle' })] })),
    /edge is not supported/
  )
  assert.throws(
    () => validation.clipDocument(documentWith([], { cutOuts: [operation({ start: 0 })] })),
    /middle of the image/
  )
  assert.throws(
    () => validation.clipDocument(documentWith([
      { id: 'bad', type: 'text', z: 1, clipRects: [{ x: 0, y: 0, width: 0, height: 2 }] }
    ])),
    /clip rectangle is empty/
  )
})
