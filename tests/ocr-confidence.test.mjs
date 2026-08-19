import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assessOcr,
  detectTable,
  extractEntities,
  findSensitive
} from '../.cache/test/src/renderer/shared/extract.js'

const word = (text, confidence, x, y, width = Math.max(18, text.length * 8), height = 18) => ({
  text,
  confidence,
  bbox: { x, y, width, height }
})

const result = (words) => ({ text: words.map((entry) => entry.text).join(' '), words })

test('accepts clean text and preserves actionable word boxes', () => {
  const source = result([
    word('Quarterly', 96, 20, 20),
    word('report', 94, 100, 20),
    word('Ready', 93, 20, 48),
    word('for', 92, 72, 48),
    word('review', 95, 104, 48)
  ])
  const assessment = assessOcr(source)

  assert.equal(assessment.disposition, 'accepted')
  assert.equal(assessment.rawAvailable, false)
  assert.equal(assessment.trusted.words.length, 5)
  assert.match(assessment.trusted.text, /Quarterly report/)
})

test('keeps a valid short URL and one-line label', () => {
  const url = assessOcr(result([word('https://clipthat.app/docs', 91, 10, 10)]))
  const label = assessOcr(result([word('Ready', 89, 10, 40)]))

  assert.equal(url.disposition, 'accepted')
  assert.deepEqual(
    extractEntities(url.trusted).map((entity) => entity.kind),
    ['url']
  )
  assert.equal(label.trusted.text, 'Ready')
})

test('keeps a confidently recognized amount', () => {
  const assessment = assessOcr(result([word('Total', 96, 10, 10), word('£42.00', 94, 100, 10)]))

  assert.equal(assessment.disposition, 'accepted')
  assert.deepEqual(
    extractEntities(assessment.trusted).map((entity) => entity.kind),
    ['money']
  )
})

test('keeps a regular, confident table', () => {
  const words = []
  const rows = [
    ['Item', 'Price', 'Status'],
    ['Notebook', '£12.00', 'Ready'],
    ['Marker', '£4.00', 'Pending']
  ]
  rows.forEach((row, rowIndex) =>
    row.forEach((text, columnIndex) =>
      words.push(word(text, 94 - rowIndex, 20 + columnIndex * 150, 20 + rowIndex * 28))
    )
  )
  const assessment = assessOcr(result(words))
  const table = detectTable(assessment.trusted)

  assert.notEqual(table, null)
  assert.equal(table.columns, 3)
  assert.equal(table.rows.length, 3)
})

test('rejects landscape-like OCR fragments as untrusted raw text', () => {
  const source = result([
    word('NLR', 58, 30, 30),
    word('£0', 61, 140, 30),
    word('rr', 44, 270, 30),
    word('vV', 53, 30, 62),
    word('I1l', 57, 140, 62),
    word('—_', 49, 270, 62),
    word('rn', 55, 30, 94),
    word('0O', 52, 140, 94),
    word('l|', 46, 270, 94),
    word('3', 92, 390, 126)
  ])
  const assessment = assessOcr(source)

  assert.equal(assessment.disposition, 'rejected')
  assert.equal(assessment.rawAvailable, true)
  assert.equal(assessment.trusted.text, '')
  assert.equal(detectTable(assessment.trusted), null)
  assert.deepEqual(extractEntities(assessment.trusted), [])
})

test('garbage does not create false structured results', () => {
  const source = result([
    word('£0', 64, 20, 20),
    word('www..bad', 63, 130, 20),
    word('NLR', 75, 20, 52),
    word('XKQ', 74, 130, 52),
    word('ZZT', 73, 240, 52),
    word('QXR', 71, 20, 84),
    word('KKB', 72, 130, 84),
    word('WWZ', 70, 240, 84)
  ])
  const assessment = assessOcr(source)

  assert.equal(assessment.disposition, 'rejected')
  assert.deepEqual(extractEntities(assessment.trusted), [])
  assert.deepEqual(findSensitive(assessment.trusted), [])
  assert.equal(detectTable(assessment.trusted), null)
})

test('mixed content keeps valid results and separates uncertain OCR', () => {
  const source = result([
    word('Documentation', 96, 20, 20),
    word('https://clipthat.app/docs', 94, 150, 20),
    word('XQZ', 45, 20, 60),
    word('£0', 49, 160, 60)
  ])
  const assessment = assessOcr(source)

  assert.equal(assessment.disposition, 'mixed')
  assert.equal(assessment.rawAvailable, true)
  assert.match(assessment.trusted.text, /Documentation/)
  assert.doesNotMatch(assessment.trusted.text, /£0/)
  assert.deepEqual(
    extractEntities(assessment.trusted).map((entity) => entity.kind),
    ['url']
  )
  assert.deepEqual(
    extractEntities(source).map((entity) => entity.kind),
    ['url']
  )
})

test('low-confidence raw OCR cannot power copy, highlight, or redaction inputs', () => {
  const source = result([word('www.fake.test', 42, 20, 20), word('test@example.com', 44, 20, 52)])
  const assessment = assessOcr(source)

  assert.equal(assessment.rawAvailable, true)
  assert.equal(assessment.trusted.text, '')
  assert.deepEqual(extractEntities(assessment.trusted), [])
  assert.deepEqual(findSensitive(assessment.trusted), [])
  assert.match(source.text, /fake/)
})
