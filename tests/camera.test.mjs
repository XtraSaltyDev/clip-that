import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { initialCamera, stepCamera, sourceRect, clampCenter, DEFAULT_CAMERA_CONFIG } = await load('camera')

const cfg = (over = {}) => ({
  width: 1920,
  height: 1080,
  zoom: 2,
  ...DEFAULT_CAMERA_CONFIG,
  ...over
})

const settle = (cam, cursor, c, frames) => {
  for (let i = 0; i < frames; i++) cam = stepCamera(cam, cursor, c)
  return cam
}

test('zoom eases from 1 toward the target and converges', () => {
  const c = cfg()
  let cam = initialCamera(c)
  assert.equal(cam.z, 1)
  const after10 = settle(cam, null, c, 10)
  assert.ok(after10.z > 1 && after10.z < 2, 'mid-ease should sit between 1x and target')
  const after300 = settle(cam, null, c, 300)
  assert.ok(Math.abs(after300.z - 2) < 0.01, 'must converge to the target zoom')
})

test('a cursor inside the dead-zone causes no pan', () => {
  const c = cfg()
  let cam = settle(initialCamera(c), null, c, 300) // settle zoom first
  const centred = { x: cam.cx + 10, y: cam.cy - 10 } // well inside the dead-zone
  const after = settle(cam, centred, c, 60)
  assert.ok(Math.abs(after.cx - cam.cx) < 0.5, 'cx must not drift')
  assert.ok(Math.abs(after.cy - cam.cy) < 0.5, 'cy must not drift')
})

test('a cursor outside the dead-zone pulls the camera toward it', () => {
  const c = cfg()
  let cam = settle(initialCamera(c), null, c, 300)
  const target = { x: 1800, y: 900 }
  const after = settle(cam, target, c, 200)
  assert.ok(after.cx > cam.cx + 100, 'camera should have panned right')
  assert.ok(after.cy > cam.cy + 50, 'camera should have panned down')
  // The real invariant: the cursor ends up *visible*. Near the frame edge the clamp
  // stops the camera before the cursor can re-enter the dead-zone — that's correct,
  // not a bug; centring on x=1800 at 2x would show pixels beyond the frame.
  const halfViewW = c.width / after.z / 2
  const halfViewH = c.height / after.z / 2
  assert.ok(target.x <= after.cx + halfViewW + 1, 'cursor must be inside the viewport (x)')
  assert.ok(target.y <= after.cy + halfViewH + 1, 'cursor must be inside the viewport (y)')
  // And the camera should have hit its clamp band exactly, not overshot it.
  assert.ok(Math.abs(after.cx - (c.width - halfViewW)) < 1, 'camera should ride the clamp boundary')
})

test('the viewport never leaves the frame, even chasing a corner', () => {
  const c = cfg({ zoom: 2.5 })
  let cam = initialCamera(c)
  for (let i = 0; i < 400; i++) {
    cam = stepCamera(cam, { x: 0, y: 0 }, c)
    const r = sourceRect(cam, c)
    assert.ok(r.sx >= -0.001 && r.sy >= -0.001, `frame ${i}: source rect left the frame (negative)`)
    assert.ok(r.sx + r.sw <= c.width + 0.001, `frame ${i}: right edge out of bounds`)
    assert.ok(r.sy + r.sh <= c.height + 0.001, `frame ${i}: bottom edge out of bounds`)
  }
})

test('clampCenter pins an out-of-range centre to the legal band', () => {
  const c = cfg()
  const clamped = clampCenter(-500, 99999, 2, c)
  assert.equal(clamped.cx, c.width / 4)
  assert.equal(clamped.cy, c.height - c.height / 4)
})

test('null cursor settles zoom without panning', () => {
  const c = cfg()
  const cam = settle(initialCamera(c), null, c, 300)
  assert.equal(Math.round(cam.cx), c.width / 2)
  assert.equal(Math.round(cam.cy), c.height / 2)
})

test('sourceRect at zoom 1 is the whole frame', () => {
  const c = cfg()
  const r = sourceRect(initialCamera(c), c)
  assert.deepEqual(r, { sx: 0, sy: 0, sw: c.width, sh: c.height })
})
