import test from 'node:test'
import assert from 'node:assert/strict'
import { load, line, ocr, row } from './helpers.mjs'

const { detectTable } = await load('extract')

/** A 4×3 grid: header plus three data rows, with two-word names in the middle column. */
function invoiceGrid() {
  return ocr(
    row(0, [
      [0, 'INVOICE'],
      [200, 'CUSTOMER'],
      [400, 'AMOUNT']
    ]),
    row(40, [
      [0, 'INV-1'],
      [200, 'Marcus'],
      [256, 'Bell'],
      [400, '$10.00']
    ]),
    row(80, [
      [0, 'INV-2'],
      [200, 'Priya'],
      [248, 'Raman'],
      [400, '$20.00']
    ]),
    row(120, [
      [0, 'INV-3'],
      [200, 'Toby'],
      [240, 'Alvarez'],
      [400, '$30.00']
    ])
  )
}

test('detects a grid and keeps the header row', () => {
  const table = detectTable(invoiceGrid())
  assert.ok(table, 'expected a table')
  assert.equal(table.columns, 3)
  assert.equal(table.rows.length, 4)
  assert.deepEqual(table.rows[0], ['INVOICE', 'CUSTOMER', 'AMOUNT'])
})

test('does not split a two-word cell into two columns', () => {
  // "Marcus Bell" sits at consistent x offsets across rows, which naively looks like
  // a column boundary. Only a real gutter counts.
  const table = detectTable(invoiceGrid())
  assert.deepEqual(table.rows[1], ['INV-1', 'Marcus Bell', '$10.00'])
  assert.deepEqual(table.rows[3], ['INV-3', 'Toby Alvarez', '$30.00'])
})

test('emits markdown with a separator row', () => {
  const table = detectTable(invoiceGrid())
  const lines = table.markdown.split('\n')
  assert.equal(lines[0], '| INVOICE | CUSTOMER | AMOUNT |')
  assert.equal(lines[1], '| --- | --- | --- |')
  assert.equal(lines[2], '| INV-1 | Marcus Bell | $10.00 |')
  assert.equal(lines.length, 5)
})

test('emits csv', () => {
  const table = detectTable(invoiceGrid())
  assert.equal(table.csv.split('\n')[0], 'INVOICE,CUSTOMER,AMOUNT')
  assert.equal(table.csv.split('\n')[1], 'INV-1,Marcus Bell,$10.00')
})

test('escapes pipes in markdown cells', () => {
  const table = detectTable(
    ocr(
      row(0, [
        [0, 'A|B'],
        [200, 'C'],
        [400, 'D']
      ]),
      row(40, [
        [0, 'e'],
        [200, 'f'],
        [400, 'g']
      ]),
      row(80, [
        [0, 'h'],
        [200, 'i'],
        [400, 'j']
      ]),
      row(120, [
        [0, 'k'],
        [200, 'l'],
        [400, 'm']
      ])
    )
  )
  assert.ok(table.markdown.startsWith('| A\\|B |'))
})

test('rejects prose', () => {
  const result = ocr(
    line('The quick brown fox jumps over the lazy dog', { y: 0 }),
    line('Pack my box with five dozen liquor jugs today', { y: 40 }),
    line('How vexingly quick daft zebras jump around', { y: 80 }),
    line('Sphinx of black quartz judge my vow now', { y: 120 })
  )
  assert.equal(detectTable(result), null)
})

test('rejects fewer than three rows', () => {
  const result = ocr(
    row(0, [
      [0, 'A'],
      [200, 'B']
    ]),
    row(40, [
      [0, 'C'],
      [200, 'D']
    ])
  )
  assert.equal(detectTable(result), null)
})

test('stops at a large vertical gap instead of swallowing later content', () => {
  const result = ocr(
    row(0, [
      [0, 'INVOICE'],
      [200, 'AMOUNT']
    ]),
    row(40, [
      [0, 'INV-1'],
      [200, '$10.00']
    ]),
    row(80, [
      [0, 'INV-2'],
      [200, '$20.00']
    ]),
    row(120, [
      [0, 'INV-3'],
      [200, '$30.00']
    ]),
    // A footer far below, aligned to the same columns.
    row(900, [
      [0, 'FOOTER'],
      [200, 'JUNK']
    ])
  )
  const table = detectTable(result)
  assert.ok(table)
  assert.equal(table.rows.length, 4)
  assert.ok(!table.markdown.includes('FOOTER'))
})

test('returns a bounding box around the rows it used', () => {
  const table = detectTable(invoiceGrid())
  assert.equal(table.bbox.x, 0)
  assert.equal(table.bbox.y, 0)
  assert.ok(table.bbox.height >= 120)
})

test('handles an empty result', () => {
  assert.equal(detectTable({ text: '', words: [] }), null)
})
