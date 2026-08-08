import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const {
  initialCamera,
  stepCamera,
  sourceRect,
  clampCenter,
  resizeCamera,
  DEFAULT_CAMERA_CONFIG
} = await load('camera')

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

const assertValidRect = (rect, dimensions, label) => {
  for (const [name, value] of Object.entries(rect)) {
    assert.ok(Number.isFinite(value), `${label}: ${name} must be finite`)
    assert.ok(Number.isInteger(value), `${label}: ${name} must be an integer`)
  }
  assert.ok(rect.sx >= 0, `${label}: source x must not be negative`)
  assert.ok(rect.sy >= 0, `${label}: source y must not be negative`)
  assert.ok(rect.sw > 0, `${label}: source width must be positive`)
  assert.ok(rect.sh > 0, `${label}: source height must be positive`)
  assert.ok(rect.sx + rect.sw <= dimensions.width, `${label}: right edge must stay in bounds`)
  assert.ok(rect.sy + rect.sh <= dimensions.height, `${label}: bottom edge must stay in bounds`)
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
    assertValidRect(r, c, `frame ${i}`)
  }
})

test('resizeCamera replaces negotiated geometry with live decoded dimensions', () => {
  const negotiated = cfg({ width: 1920, height: 1080, zoom: 2.5 })
  const chased = settle(
    initialCamera(negotiated),
    { x: negotiated.width, y: negotiated.height },
    negotiated,
    180
  )

  for (const live of [
    cfg({ width: 3024, height: 1964, zoom: negotiated.zoom }),
    cfg({ width: 5120, height: 1440, zoom: negotiated.zoom })
  ]) {
    const resized = resizeCamera(chased, negotiated, live)
    const rect = sourceRect(resized, live)
    assertValidRect(rect, live, `${negotiated.width}x${negotiated.height} -> ${live.width}x${live.height}`)
    assert.ok(
      Math.abs(resized.cx / live.width - chased.cx / negotiated.width) < 1e-12,
      'horizontal camera position must remain proportional'
    )
    assert.ok(
      Math.abs(resized.cy / live.height - chased.cy / negotiated.height) < 1e-12,
      'vertical camera position must remain proportional'
    )
  }
})

test('mid-stream decoded resize stays contained while chasing both lower corners', () => {
  let current = cfg({ width: 3024, height: 1964, zoom: 2.5 })
  let cam = initialCamera(current)

  for (let frame = 0; frame < 600; frame++) {
    if (frame === 300) {
      const resized = cfg({ width: 5120, height: 1440, zoom: current.zoom })
      cam = resizeCamera(cam, current, resized)
      current = resized
    }

    const cursor = frame < 300
      ? { x: 0, y: current.height }
      : { x: current.width, y: current.height }
    cam = stepCamera(cam, cursor, current)
    assertValidRect(sourceRect(cam, current), current, `frame ${frame} at ${current.width}x${current.height}`)
  }

  const final = sourceRect(cam, current)
  assert.equal(final.sx + final.sw, current.width, 'lower-right chase must finish on the right edge')
  assert.equal(final.sy + final.sh, current.height, 'lower-right chase must finish on the bottom edge')
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

test('sourceRect at zoom 1 is exactly the whole live frame', () => {
  for (const dimensions of [
    { width: 1920, height: 1080 },
    { width: 3024, height: 1964 },
    { width: 5120, height: 1440 }
  ]) {
    const c = cfg({ ...dimensions, zoom: 1 })
    const r = sourceRect(initialCamera(c), c)
    assert.deepEqual(r, { sx: 0, sy: 0, sw: c.width, sh: c.height })
    assertValidRect(r, c, `${c.width}x${c.height} at 1x`)
  }
})
