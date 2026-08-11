import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const {
  clampRotateCenter,
  clampToolbarCenter,
  clampedRotateHandleRect,
  chooseRotateSide,
  floatingToolbarTop,
  floatingToolbarHidden,
  floatingToolbarShown,
  floatingToolbarWithBounds,
  horizontalViewportBounds,
  isFloatingToolbarVisible,
  rectOverflow,
  resolveRotateSide,
  rotateAnchorOffset,
  rotateHandleRect,
  toolbarIsAbove
} = await load('rotationHandle')

const stage = { left: 0, top: 0, right: 640, bottom: 480 }

test('toolbar lifecycle hides during a transform and shows with committed bounds on release', () => {
  const before = { left: 120, top: 140, width: 80 }
  const committed = { left: 260, top: 180, width: 120 }
  const hidden = floatingToolbarHidden()
  assert.deepEqual(hidden, { transforming: true, box: null })

  const active = floatingToolbarWithBounds(hidden, committed)

  assert.equal(isFloatingToolbarVisible(active), false)
  assert.deepEqual(active.box, committed)

  const released = floatingToolbarShown(committed)
  assert.equal(released.transforming, false)
  assert.equal(isFloatingToolbarVisible(released), true)
  assert.deepEqual(released.box, committed)
  assert.notDeepEqual(released.box, before)
})

test('toolbar and handle use opposite sides near the top edge', () => {
  assert.equal(toolbarIsAbove(55), true)
  assert.equal(toolbarIsAbove(54), false)
  assert.equal(chooseRotateSide({ left: 200, top: 54, width: 80, height: 30 }, stage), 'above')
})

test('toolbar below a short top-edge selection starts after its bottom edge', () => {
  const selection = { top: 30, height: 5 }
  assert.equal(floatingToolbarTop(selection.top, selection.height), 43)
  assert.ok(floatingToolbarTop(selection.top, selection.height) > selection.top + selection.height)
})

test('measured toolbar center stays inside the stage at both horizontal edges', () => {
  const bounds = { left: 0, right: 640 }
  assert.equal(clampToolbarCenter(20, 240, bounds), 124)
  assert.equal(clampToolbarCenter(620, 240, bounds), 516)
})

test('measured toolbar center follows a horizontally scrolled viewport interval', () => {
  const visible = horizontalViewportBounds(-280, 40, 680)
  assert.deepEqual(visible, { left: 320, right: 960 })
  assert.equal(clampToolbarCenter(340, 240, visible, 24), 464)
  assert.equal(clampToolbarCenter(940, 240, visible, 24), 816)
  assert.equal(clampToolbarCenter(640, 240, visible, 24), 640)
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

test('a rotation gesture keeps its initial transformer-relative side even when bounds cross an edge', () => {
  const before = { left: 200, top: 180, width: 80, height: 30 }
  const after = { left: 200, top: 420, width: 80, height: 40 }
  const locked = resolveRotateSide(before, stage, null)

  assert.equal(locked, 'below')
  assert.equal(resolveRotateSide(after, stage, locked), 'below')
  assert.equal(resolveRotateSide(after, stage, null), 'above')
})

test('the handle remains reachable at every canvas corner after side selection', () => {
  const selections = [
    { left: 0, top: 0, width: 36, height: 24 },
    { left: 604, top: 0, width: 36, height: 24 },
    { left: 0, top: 456, width: 36, height: 24 },
    { left: 604, top: 456, width: 36, height: 24 }
  ]

  for (const selection of selections) {
    const side = chooseRotateSide(selection, stage)
    const handle = clampedRotateHandleRect(selection, side, stage)
    assert.equal(rectOverflow(handle, stage), 0, `${selection.left},${selection.top}`)
  }
})

test('screen-space bounds for cardinal and diagonal rotations keep the handle inside the stage', () => {
  const rotatedAabb = (angle) => {
    const source = { left: 270, top: 220, width: 100, height: 40 }
    const radians = (angle * Math.PI) / 180
    const center = { x: source.left + source.width / 2, y: source.top + source.height / 2 }
    const corners = [
      [-source.width / 2, -source.height / 2],
      [source.width / 2, -source.height / 2],
      [source.width / 2, source.height / 2],
      [-source.width / 2, source.height / 2]
    ].map(([x, y]) => ({
      x: center.x + x * Math.cos(radians) - y * Math.sin(radians),
      y: center.y + x * Math.sin(radians) + y * Math.cos(radians)
    }))
    const left = Math.min(...corners.map(({ x }) => x))
    const top = Math.min(...corners.map(({ y }) => y))
    const right = Math.max(...corners.map(({ x }) => x))
    const bottom = Math.max(...corners.map(({ y }) => y))
    return { left, top, width: right - left, height: bottom - top }
  }

  const rotations = [0, 45, 90, 180, 270]

  for (const angle of rotations) {
    const selection = rotatedAabb(angle)
    const side = chooseRotateSide(selection, stage)
    assert.equal(
      rectOverflow(clampedRotateHandleRect(selection, side, stage), stage),
      0,
      `${angle}°`
    )
  }
})

test('signed Konva offsets preserve visual above and below placement for flipped nodes', () => {
  assert.equal(rotateAnchorOffset(100, 2, 'below'), -127)
  assert.equal(rotateAnchorOffset(100, 2, 'above'), 23)
  assert.equal(rotateAnchorOffset(-100, 2, 'below'), 27)
  assert.equal(rotateAnchorOffset(-100, 2, 'above'), -123)
})
