import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { computeLayout, frameHeight } = await load('layout')

const doc = (over = {}) => ({
  imageWidth: 1200,
  imageHeight: 800,
  crop: { enabled: false, x: 0, y: 0, width: 1200, height: 800 },
  canvas: { padding: 0, radius: 0, frame: 'none', ...over.canvas },
  ...over
})

test('an unstyled capture maps 1:1', () => {
  const l = computeLayout(doc())
  assert.equal(l.contentWidth, 1200)
  assert.equal(l.contentHeight, 800)
  assert.equal(l.canvasWidth, 1200)
  assert.equal(l.canvasHeight, 800)
  assert.equal(l.shotX, 0)
  assert.equal(l.shotY, 0)
})

test('crop drives the content size and origin', () => {
  const l = computeLayout(doc({ crop: { enabled: true, x: 100, y: 50, width: 400, height: 300 } }))
  assert.equal(l.contentWidth, 400)
  assert.equal(l.contentHeight, 300)
  assert.equal(l.cropX, 100)
  assert.equal(l.cropY, 50)
})

test('padding surrounds the shot and keeps it centred', () => {
  const l = computeLayout(doc({ canvas: { padding: 64, radius: 0, frame: 'none' } }))
  assert.equal(l.canvasWidth, 1200 + 128)
  assert.equal(l.canvasHeight, 800 + 128)
  assert.equal(l.shotX, 64)
  assert.equal(l.shotY, 64)
})

test('padding scales with the capture so it stays visible on a 4K shot', () => {
  const small = computeLayout(doc({ canvas: { padding: 50, radius: 0, frame: 'none' } }))
  const large = computeLayout(
    doc({
      imageWidth: 2400,
      crop: { enabled: false, x: 0, y: 0, width: 2400, height: 800 },
      canvas: { padding: 50, radius: 0, frame: 'none' }
    })
  )
  assert.equal(small.padding, 50)
  assert.equal(large.padding, 100)
})

test('an aspect preset grows the canvas without stretching the shot', () => {
  const l = computeLayout(doc({ canvas: { padding: 0, radius: 0, frame: 'none', aspect: '16:9' } }))
  assert.equal(l.contentWidth, 1200, 'the screenshot itself must not change size')
  assert.equal(l.contentHeight, 800)
  // Integer canvas dimensions mean the ratio lands within a pixel, not exactly.
  assert.ok(Math.abs(l.canvasWidth / l.canvasHeight - 16 / 9) < 0.01)
  assert.ok(l.shotX > 0, 'the shot should be centred in the wider box')
})

test('a portrait aspect preset letterboxes vertically', () => {
  const l = computeLayout(doc({ canvas: { padding: 0, radius: 0, frame: 'none', aspect: '9:16' } }))
  assert.equal(l.contentWidth, 1200)
  assert.ok(l.shotY > 0, 'the shot should be centred in the taller box')
  assert.equal(l.shotX, 0)
})

test('a window frame adds a title bar above the shot', () => {
  const plain = computeLayout(doc())
  const framed = computeLayout(doc({ canvas: { padding: 0, radius: 0, frame: 'macos' } }))
  assert.equal(plain.frameHeight, 0)
  assert.ok(framed.frameHeight >= 28)
  assert.equal(framed.canvasHeight, 800 + framed.frameHeight)
})

test('frame height is clamped for very small and very large captures', () => {
  assert.equal(frameHeight(doc({ imageWidth: 200, canvas: { frame: 'macos' } })), 28)
  assert.equal(frameHeight(doc({ imageWidth: 4000, canvas: { frame: 'macos' } })), 52)
})
