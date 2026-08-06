import test from 'node:test'
import assert from 'node:assert/strict'
import { load, line, ocr, word } from './helpers.mjs'

const { suggestTitle } = await load('extract')

test('picks the tallest heading near the top', () => {
  const result = ocr(
    [word('Invoices', 0, 40, { height: 30 })],
    line('some smaller body copy underneath', { y: 120, height: 12 })
  )
  assert.equal(suggestTitle(result, 1000), 'Invoices')
})

test('ignores text in the lower half of the capture', () => {
  const result = ocr([word('Footer', 0, 900, { height: 40 })])
  assert.equal(suggestTitle(result, 1000), null)
})

test('strips stray punctuation OCR attaches to a heading', () => {
  const result = ocr([word('Invoices', 0, 40, { height: 30 }), word('.', 200, 40, { height: 30 })])
  assert.equal(suggestTitle(result, 1000), 'Invoices')
})

test('skips lines that are addresses or labels rather than titles', () => {
  const result = ocr([word('owner@example.com', 0, 40, { height: 30 })])
  assert.equal(suggestTitle(result, 1000), null)
})

test('ignores low-confidence garbage', () => {
  const result = ocr([word('rubbish', 0, 40, { height: 40, confidence: 20 })])
  assert.equal(suggestTitle(result, 1000), null)
})

test('never returns characters that are illegal in a filename', () => {
  const result = ocr([word('Report', 0, 40, { height: 30 }), word('2026', 80, 40, { height: 30 })])
  const title = suggestTitle(result, 1000)
  assert.ok(title)
  assert.ok(!/[\\/:*?"<>|]/.test(title))
})

test('returns null when there is no text', () => {
  assert.equal(suggestTitle({ text: '', words: [] }, 1000), null)
})
