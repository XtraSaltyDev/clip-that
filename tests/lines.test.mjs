import test from 'node:test'
import assert from 'node:assert/strict'
import { load, ocr, word } from './helpers.mjs'

const { toLines, unionBox, normalizeDashes } = await load('extract')

const texts = (lines) => lines.map((l) => l.map((w) => w.text).join(' '))

test('groups words on the same baseline into one line', () => {
  const lines = toLines([word('Hello', 0, 100), word('world', 50, 101), word('again', 120, 99)])
  assert.deepEqual(texts(lines), ['Hello world again'])
})

test('orders words left to right regardless of input order', () => {
  const lines = toLines([word('third', 200, 10), word('first', 0, 10), word('second', 100, 10)])
  assert.deepEqual(texts(lines), ['first second third'])
})

test('orders lines top to bottom', () => {
  const lines = toLines([word('bottom', 0, 200), word('top', 0, 0), word('middle', 0, 100)])
  assert.deepEqual(texts(lines), ['top', 'middle', 'bottom'])
})

test('a tall heading does not absorb the subtitle below it', () => {
  // The regression this exists for: comparing y positions alone merged a 30px heading
  // with a 14px subtitle 24px lower, which corrupted both titles and tables.
  const heading = word('Invoices', 0, 100, { height: 30 })
  const subtitle = word('Account', 0, 138, { height: 14 })
  assert.deepEqual(texts(toLines([heading, subtitle])), ['Invoices', 'Account'])
})

test('words overlapping by more than half their height stay together', () => {
  const a = word('Big', 0, 100, { height: 20 })
  const b = word('small', 40, 106, { height: 12 })
  assert.deepEqual(texts(toLines([a, b])), ['Big small'])
})

test('unionBox spans every word given', () => {
  const box = unionBox([word('ab', 10, 20, { height: 10 }), word('cd', 100, 25, { height: 10 })])
  assert.deepEqual(box, { x: 10, y: 20, width: 106, height: 15 })
})

test('normalizeDashes folds typographic dashes to ASCII', () => {
  assert.equal(normalizeDashes('sk—key'), 'sk-key')
  assert.equal(normalizeDashes('a‐b–c−d'), 'a-b-c-d')
  assert.equal(normalizeDashes('already-fine'), 'already-fine')
})

test('empty input produces no lines', () => {
  assert.deepEqual(toLines([]), [])
  assert.deepEqual(ocr().words, [])
})
