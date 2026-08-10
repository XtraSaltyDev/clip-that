import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { shapeTransformPatch } = await load('transforms')

const node = (values) => ({
  x: () => values.x ?? 0,
  y: () => values.y ?? 0,
  width: () => values.width ?? 100,
  height: () => values.height ?? 40,
  scaleX: () => values.scaleX ?? 1,
  scaleY: () => values.scaleY ?? 1,
  rotation: () => values.rotation ?? 0
})

test('rotation patch applies to every shape family without requiring a rotation field', () => {
  const shapes = [
    { type: 'arrow', points: [1, 2, 3, 4] },
    { type: 'line', points: [1, 2, 3, 4] },
    { type: 'pen', points: [1, 2, 3, 4] },
    { type: 'highlighter', points: [1, 2, 3, 4] },
    { type: 'rect', x: 1, y: 2, width: 20, height: 10 },
    { type: 'ellipse', x: 1, y: 2, width: 20, height: 10 },
    { type: 'text', x: 1, y: 2, width: 20, text: 'x', fontFamily: 'sans', fontSize: 12, color: '#fff' },
    { type: 'callout', x: 1, y: 2, width: 20, height: 10, text: 'x', fontFamily: 'sans', fontSize: 12, color: '#fff' },
    { type: 'step', x: 1, y: 2, radius: 10, index: 1, fill: '#f00', color: '#fff', fontSize: 12 },
    { type: 'blur', x: 1, y: 2, width: 20, height: 10 },
    { type: 'pixelate', x: 1, y: 2, width: 20, height: 10 },
    { type: 'redact', x: 1, y: 2, width: 20, height: 10 },
    { type: 'spotlight', x: 1, y: 2, width: 20, height: 10 },
    { type: 'magnify', x: 1, y: 2, width: 20, height: 10 },
    { type: 'measure', points: [10, 10, 30, 10] }
  ]

  for (const shape of shapes) {
    assert.equal(shapeTransformPatch(shape, node({ rotation: 41 })).rotation, 41, shape.type)
  }
})

test('point transforms bake transient scale and translation while retaining rotation', () => {
  const shape = { type: 'line', points: [1, 2, 3, 4] }
  const patch = shapeTransformPatch(shape, node({ x: 10, y: 20, scaleX: 2, scaleY: 3, rotation: 15 }))
  assert.deepEqual(patch.points, [12, 26, 16, 32])
  assert.equal(patch.rotation, 15)
})

test('spotlight rotation does not replace its nested annotation geometry', () => {
  const shape = { type: 'spotlight', x: 30, y: 40, width: 50, height: 25 }
  assert.deepEqual(shapeTransformPatch(shape, node({ x: 0, y: 0, rotation: 24 })), { rotation: 24 })
})
