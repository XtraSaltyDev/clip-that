import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from './helpers.mjs'

const validation = await load('src/main/ipc/validation.js')

const arrow = {
  id: 'arrow-1',
  type: 'arrow',
  z: 1,
  stroke: '#ff3b30',
  strokeWidth: 4,
  points: [10, 20, 100, 120],
  endHead: true,
  shadow: true,
  shadowColor: '#000000',
  shadowBlur: 6,
  shadowOffsetX: 0,
  shadowOffsetY: 2
}

const textShape = {
  id: 'text-1',
  type: 'text',
  z: 2,
  x: 20,
  y: 30,
  width: 240,
  text: 'Review this',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 28,
  color: '#ffffff',
  background: '#ff3b30',
  padding: 8,
  fillOpacity: 1
}

test('annotation clipboard accepts complete valid shape families and clones them', () => {
  const source = [arrow, textShape]
  const parsed = validation.annotationShapes(source)
  assert.deepEqual(parsed, source)
  assert.notEqual(parsed, source)
})

test('annotation clipboard rejects malformed geometry, styles and extra fields', () => {
  assert.throws(
    () => validation.annotationShapes([{ ...arrow, points: [0, Number.NaN, 1, 1] }]),
    /outside the supported range/
  )
  assert.throws(
    () => validation.annotationShapes([{ ...arrow, stroke: 'url(https://example.test/x)' }]),
    /hex colour/
  )
  assert.throws(
    () => validation.annotationShapes([{ ...textShape, fontSize: -1 }]),
    /outside the supported range/
  )
  assert.throws(
    () => validation.annotationShapes([{ ...arrow, command: 'open /tmp' }]),
    /not supported/
  )
})

test('external links remain limited to HTTP and HTTPS', () => {
  assert.equal(validation.externalUrl('https://example.com/path'), 'https://example.com/path')
  assert.throws(() => validation.externalUrl('javascript:alert(1)'), /HTTP or HTTPS/)
  assert.throws(() => validation.externalUrl('file:///etc/passwd'), /HTTP or HTTPS/)
})

test('capture handoff actions accept the complete local action set', () => {
  for (const action of ['copy', 'save', 'pin', 'edit', 'reveal', 'pipeline']) {
    assert.equal(validation.quickAction(action), action)
  }
  assert.throws(() => validation.quickAction('upload'), /quick action/)
})

test('OCR IPC preserves validated confidence and geometry', () => {
  const payload = {
    id: 'ocr-1',
    result: {
      text: 'Ready',
      words: [{ text: 'Ready', confidence: 94, bbox: { x: 10, y: 20, width: 52, height: 18 } }]
    }
  }
  assert.deepEqual(validation.ocrResponse(payload), payload)
  assert.notEqual(validation.ocrResponse(payload).result.words[0], payload.result.words[0])
})

test('OCR IPC rejects malformed confidence, geometry, and unknown fields', () => {
  const word = { text: 'Ready', confidence: 94, bbox: { x: 10, y: 20, width: 52, height: 18 } }
  const response = (entry) => ({ id: 'ocr-1', result: { text: entry.text, words: [entry] } })
  assert.throws(
    () => validation.ocrResponse(response({ ...word, confidence: Number.NaN })),
    /range/
  )
  assert.throws(() => validation.ocrResponse(response({ ...word, confidence: 101 })), /range/)
  assert.throws(
    () => validation.ocrResponse(response({ ...word, bbox: { x: 10, y: 20 } })),
    /range/
  )
  assert.throws(() => validation.ocrResponse(response({ ...word, raw: true })), /not supported/)
  assert.throws(
    () => validation.ocrResponse({ id: 'ocr-1', result: { text: '', words: new Array(100_001) } }),
    /words are invalid/
  )
})
