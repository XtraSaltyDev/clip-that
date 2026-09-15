import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from './helpers.mjs'
const { sameOcrSource } = await load('src/renderer/editor/ocr-source.js')
const source = {
  id: 'capture-a',
  image: 'image-a',
  crop: { enabled: true, x: 1, y: 2, width: 30, height: 40 }
}

test('OCR responses are rejected after switching captures, replacing an image, or changing the crop', () => {
  assert.equal(sameOcrSource(null, source), false)
  assert.equal(sameOcrSource({ ...source, id: 'capture-b' }, source), false)
  assert.equal(sameOcrSource({ ...source, image: 'image-b' }, source), false)
  for (const patch of [{ enabled: false }, { x: 5 }, { y: 5 }, { width: 5 }, { height: 5 }]) {
    assert.equal(sameOcrSource({ ...source, crop: { ...source.crop, ...patch } }, source), false)
  }
})

test('changing a title or annotations does not discard an otherwise valid OCR result', () => {
  assert.equal(sameOcrSource({ ...source, title: 'Renamed', shapes: [{}] }, source), true)
  const fullImage = { ...source, crop: { ...source.crop, enabled: false } }
  assert.equal(sameOcrSource({ ...fullImage, crop: { ...fullImage.crop, x: 99 } }, fullImage), true)
})
