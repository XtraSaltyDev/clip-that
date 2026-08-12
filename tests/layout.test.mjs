import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { computeLayout, fitScale, frameHeight } = await load('layout')
const { expandedAnnotationInsets, annotationPaintedBounds } = await load('annotationBounds')

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

test('fit scale keeps a large image fully inside the available editor viewport', () => {
  const layout = computeLayout(
    doc({
      imageWidth: 2560,
      imageHeight: 1536,
      crop: { enabled: false, x: 0, y: 0, width: 2560, height: 1536 }
    })
  )
  const scale = fitScale(layout, 840, 590)

  assert.ok(layout.canvasWidth * scale <= 840 - 64)
  assert.ok(layout.canvasHeight * scale <= 590 - 64)
  assert.ok(scale < 1)
})

test('automatic insets preserve legacy dimensions and move only the capture origin', () => {
  const plain = computeLayout(doc())
  const expanded = computeLayout(
    doc({
      canvas: {
        padding: 0,
        radius: 0,
        frame: 'none',
        annotationInsets: { top: 12, right: 24, bottom: 36, left: 48 }
      }
    })
  )
  assert.deepEqual(plain.annotationInsets, { top: 0, right: 0, bottom: 0, left: 0 })
  assert.equal(expanded.canvasWidth, plain.canvasWidth + 48 + 24)
  assert.equal(expanded.canvasHeight, plain.canvasHeight + 12 + 36)
  assert.equal(expanded.shotX, plain.shotX + 48)
  assert.equal(expanded.shotY, plain.shotY + 12)
  assert.equal(expanded.contentWidth, plain.contentWidth)
  assert.equal(expanded.contentHeight, plain.contentHeight)
})

test('automatic insets are asymmetric and compose with padding, frame, aspect, crop and Cut Out', () => {
  const padded = computeLayout(
    doc({
      crop: { enabled: true, x: 100, y: 50, width: 400, height: 300 },
      canvas: {
        padding: 20,
        radius: 0,
        frame: 'macos',
        aspect: '16:9',
        annotationInsets: { top: 7, right: 31, bottom: 11, left: 5 }
      }
    })
  )
  const base = computeLayout(
    doc({
      crop: { enabled: true, x: 100, y: 50, width: 400, height: 300 },
      canvas: { padding: 20, radius: 0, frame: 'macos', aspect: '16:9' }
    })
  )
  assert.equal(padded.canvasWidth, base.canvasWidth + 36)
  assert.equal(padded.canvasHeight, base.canvasHeight + 18)
  assert.equal(padded.shotX, base.shotX + 5)
  assert.equal(padded.shotY, base.shotY + 7)

  const cutOut = computeLayout(
    doc({
      imageWidth: 100,
      imageHeight: 100,
      crop: { enabled: false, x: 0, y: 0, width: 100, height: 100 },
      cutOuts: [
        {
          source: { x: 0, y: 30, width: 100, height: 40 },
          axis: 'horizontal',
          start: 10,
          size: 20,
          edge: 'straight'
        }
      ],
      canvas: {
        padding: 0,
        radius: 0,
        frame: 'none',
        annotationInsets: { top: 3, right: 4, bottom: 5, left: 6 }
      }
    })
  )
  assert.equal(cutOut.cropX, 0)
  assert.equal(cutOut.cropY, 0)
  assert.deepEqual(cutOut.annotationInsets, { top: 3, right: 4, bottom: 5, left: 6 })
})

test('painted bounds include strokes, arrowheads, labels and visible shadows without hit padding', () => {
  const arrow = {
    id: 'arrow',
    type: 'arrow',
    z: 1,
    points: [90, 50, 10, 50],
    stroke: '#f00',
    strokeWidth: 4,
    headScale: 3,
    endHead: true,
    shadow: false
  }
  const measure = {
    id: 'measure',
    type: 'measure',
    z: 2,
    points: [20, 20, 80, 80],
    stroke: '#00f',
    strokeWidth: 4,
    curve: 140,
    shadow: false
  }
  const shadowed = {
    id: 'rect',
    type: 'rect',
    z: 3,
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    stroke: '#fff',
    strokeWidth: 2,
    fill: undefined,
    shadow: true,
    shadowBlur: 8,
    shadowOffsetX: 4,
    shadowOffsetY: 5
  }
  const arrowBounds = annotationPaintedBounds(arrow)
  const measureBounds = annotationPaintedBounds(measure)
  const shadowBounds = annotationPaintedBounds(shadowed)
  assert.ok(arrowBounds.left < 10 && arrowBounds.right > 90, 'arrowhead/stroke bounds were lost')
  assert.ok(
    measureBounds.top < 20 && measureBounds.bottom > 80,
    'measure path/label bounds were lost'
  )
  assert.ok(shadowBounds.left < 0 && shadowBounds.bottom > 20, 'visible shadow was not included')
})

test('expanded insets grow only the sides needed by painted annotation bounds', () => {
  const base = doc({
    imageWidth: 100,
    imageHeight: 80,
    crop: { enabled: false, x: 0, y: 0, width: 100, height: 80 }
  })
  const rightShape = {
    id: 'r',
    type: 'line',
    z: 1,
    points: [90, 40, 145, 40],
    stroke: '#0f0',
    strokeWidth: 4
  }
  const leftShape = {
    id: 'l',
    type: 'line',
    z: 2,
    points: [-45, 20, 20, 20],
    stroke: '#0f0',
    strokeWidth: 4
  }
  const right = expandedAnnotationInsets({ ...base, shapes: [rightShape] })
  const both = expandedAnnotationInsets({ ...base, shapes: [rightShape, leftShape] })
  assert.equal(right.top, 0)
  assert.equal(right.bottom, 0)
  assert.equal(right.left, 0)
  assert.ok(right.right > 0)
  assert.ok(both.left > 0 && both.right === right.right)
})
