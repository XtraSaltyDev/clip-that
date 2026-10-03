import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from './helpers.mjs'

const { compareImages, comparisonSize, COMPARE_MAX_PIXELS, COMPARE_MAX_EDGE } = await load(
  'src/shared/image-compare.js'
)

function image(width, height, color = [255, 255, 255, 255]) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(color, offset)
  return pixels
}

function fill(pixels, width, x, y, w, h, color) {
  for (let row = y; row < y + h; row++)
    for (let col = x; col < x + w; col++) pixels.set(color, (row * width + col) * 4)
}

test('identical captures have no changes, no regions, and an independent heatmap', () => {
  const before = image(96, 96)
  const copy = before.slice()
  const result = compareImages(before, copy, 96, 96, 0)
  assert.equal(result.changedPixels, 0)
  assert.equal(result.changedPercent, 0)
  assert.deepEqual(result.regions, [])
  assert.deepEqual(before, copy)
  assert.notEqual(result.heatmap, before)
})

test('known changes report exact pixel counts, percentage, bounds, and separated regions', () => {
  const before = image(120, 120)
  const after = before.slice()
  fill(after, 120, 3, 5, 10, 12, [0, 0, 0, 255])
  fill(after, 120, 96, 96, 4, 5, [0, 0, 0, 255])
  const result = compareImages(before, after, 120, 120)
  assert.equal(result.changedPixels, 140)
  assert.equal(result.comparedPixels, 14400)
  assert.equal(result.changedPercent, (140 / 14400) * 100)
  assert.deepEqual(result.regions, [
    { x: 3, y: 5, width: 10, height: 12, pixels: 120 },
    { x: 96, y: 96, width: 4, height: 5, pixels: 20 }
  ])
  assert.deepEqual(
    [...result.heatmap.slice((5 * 120 + 3) * 4, (5 * 120 + 3) * 4 + 4)],
    [255, 45, 104, 255]
  )
})

test('adjacent tiles merge and row boundaries do not wrap into false neighbours', () => {
  const before = image(96, 96)
  const after = before.slice()
  fill(after, 96, 20, 8, 12, 2, [0, 0, 0, 255])
  assert.deepEqual(compareImages(before, after, 96, 96).regions, [
    { x: 20, y: 8, width: 12, height: 2, pixels: 24 }
  ])
  const boundary = before.slice()
  fill(boundary, 96, 95, 0, 1, 1, [0, 0, 0, 255])
  fill(boundary, 96, 0, 24, 1, 1, [0, 0, 0, 255])
  assert.equal(compareImages(before, boundary, 96, 96).regions.length, 2)
})

test('tolerance ignores small colour changes without hiding larger ones', () => {
  const before = image(2, 1)
  const after = image(2, 1, [245, 255, 255, 255])
  after.set([225, 255, 255, 255], 4)
  assert.equal(compareImages(before, after, 2, 1, 10).changedPixels, 1)
  assert.equal(compareImages(before, after, 2, 1, 0).changedPixels, 2)
  assert.equal(compareImages(before, after, 2, 1, 30).changedPixels, 0)
})

test('transparent padding is excluded, hidden RGB is ignored, and added white pixels count', () => {
  const before = image(2, 1, [255, 10, 10, 0])
  const after = image(2, 1, [0, 255, 100, 0])
  const empty = compareImages(before, after, 2, 1)
  assert.equal(empty.comparedPixels, 0)
  assert.equal(empty.changedPercent, 0)
  assert.equal(empty.heatmap[3], 0)
  after.set([255, 255, 255, 255], 4)
  const result = compareImages(before, after, 2, 1)
  assert.equal(result.comparedPixels, 1)
  assert.equal(result.changedPixels, 1)
  assert.equal(result.changedPercent, 100)
})

test('swapping captures preserves counts and changes are measured on their union', () => {
  const before = image(4, 4, [0, 0, 0, 0])
  const after = before.slice()
  fill(before, 4, 0, 0, 2, 2, [0, 0, 0, 255])
  fill(after, 4, 0, 0, 4, 4, [255, 255, 255, 255])
  const forward = compareImages(before, after, 4, 4)
  const reverse = compareImages(after, before, 4, 4)
  assert.equal(forward.comparedPixels, 16)
  assert.equal(forward.changedPixels, reverse.changedPixels)
  assert.deepEqual(forward.regions, reverse.regions)
})

test('large and mismatched captures use one bounded scale without stretching', () => {
  assert.deepEqual(comparisonSize({ width: 800, height: 600 }, { width: 500, height: 900 }), {
    width: 800,
    height: 900,
    scale: 1
  })
  for (const size of [
    { width: 12000, height: 8000 },
    { width: 800, height: 60000 },
    { width: 60000, height: 800 },
    { width: 2400, height: 2400 }
  ]) {
    const result = comparisonSize(size, { width: 100, height: 100 })
    assert.ok(result.width * result.height <= COMPARE_MAX_PIXELS)
    assert.ok(result.width <= COMPARE_MAX_EDGE && result.height <= COMPARE_MAX_EDGE)
    assert.ok(result.scale > 0 && result.scale <= 1)
    assert.equal(result.width, Math.floor(size.width * result.scale))
  }
})

test('invalid buffers, dimensions, and thresholds fail before analysis', () => {
  for (const [width, height] of [
    [0, 1],
    [-1, 1],
    [1.5, 1],
    [Infinity, 1],
    [2400, 2400]
  ])
    assert.throws(
      () => compareImages(new Uint8ClampedArray(), new Uint8ClampedArray(), width, height),
      /invalid or too large/
    )
  assert.throws(() => compareImages(image(1, 1), image(2, 1), 1, 1), /invalid/)
  for (const threshold of [-1, 256, NaN, Infinity])
    assert.throws(() => compareImages(image(1, 1), image(1, 1), 1, 1, threshold), /tolerance/)
  assert.throws(
    () => comparisonSize({ width: 0, height: 10 }, { width: 10, height: 10 }),
    /dimensions/
  )
})
