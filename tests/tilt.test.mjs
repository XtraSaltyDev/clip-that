import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { canvasTiltTransform } = await load('tilt')

test('visible-axis tilt uses orthogonal skew terms', () => {
  const horizontal = canvasTiltTransform({ tiltX: 20, tiltY: 0, tiltSemantics: 'visible-axis' })
  const vertical = canvasTiltTransform({ tiltX: 0, tiltY: 20, tiltSemantics: 'visible-axis' })

  assert.notDeepEqual(horizontal, vertical)
  assert.equal(horizontal.skewY, 0)
  assert.equal(vertical.skewX, 0)
  assert.notEqual(horizontal.skewX, 0)
  assert.notEqual(vertical.skewY, 0)
})

test('visible-axis tilt reverses skew direction without changing foreshortening', () => {
  const positive = canvasTiltTransform({ tiltX: 18, tiltY: 0, tiltSemantics: 'visible-axis' })
  const negative = canvasTiltTransform({ tiltX: -18, tiltY: 0, tiltSemantics: 'visible-axis' })

  assert.equal(negative.skewX, -positive.skewX)
  assert.equal(negative.skewY, positive.skewY)
  assert.equal(negative.scaleX, positive.scaleX)
  assert.equal(negative.scaleY, positive.scaleY)
})

test('legacy tilt keeps the v0.1.7 stored-axis mapping', () => {
  const legacy = canvasTiltTransform({ tiltX: 0, tiltY: 20 })
  assert.ok(Math.abs(legacy.skewX) < 1e-12)
  assert.notEqual(legacy.skewY, 0)
})
