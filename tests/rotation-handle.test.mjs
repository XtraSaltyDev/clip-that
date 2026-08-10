import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const {
  clampRotateCenter,
  chooseRotateSide,
  rectOverflow,
  rotateAnchorOffset,
  rotateHandleRect,
  toolbarIsAbove
} = await load('rotationHandle')

const stage = { left: 0, top: 0, right: 640, bottom: 480 }

test('toolbar and handle use opposite sides near the top edge', () => {
  assert.equal(toolbarIsAbove(55), true)
  assert.equal(toolbarIsAbove(54), false)
  assert.equal(chooseRotateSide({ left: 200, top: 54, width: 80, height: 30 }, stage), 'above')
})

test('handle stays below a normal selection when the toolbar is above', () => {
  const selection = { left: 200, top: 180, width: 80, height: 30 }
  assert.equal(chooseRotateSide(selection, stage), 'below')
  assert.equal(rectOverflow(rotateHandleRect(selection, 'below'), stage), 0)
})

test('handle flips above when the preferred position would leave the stage', () => {
  const selection = { left: 200, top: 420, width: 80, height: 40 }
  assert.equal(chooseRotateSide(selection, stage), 'above')
  assert.equal(rectOverflow(rotateHandleRect(selection, 'above'), stage), 0)
})

test('handle center is clamped horizontally and vertically at the stage edge', () => {
  assert.deepEqual(clampRotateCenter({ x: 638, y: 4 }, 20, stage), { x: 630, y: 10 })
})

test('signed Konva offsets preserve visual above and below placement for flipped nodes', () => {
  assert.equal(rotateAnchorOffset(100, 2, 'below'), -127)
  assert.equal(rotateAnchorOffset(100, 2, 'above'), 23)
  assert.equal(rotateAnchorOffset(-100, 2, 'below'), 27)
  assert.equal(rotateAnchorOffset(-100, 2, 'above'), -123)
})
