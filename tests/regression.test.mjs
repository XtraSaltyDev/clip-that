import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, load } from './helpers.mjs'

const { detectTable, extractEntities, findSensitive, suggestTitle } = await load('extract')

/**
 * End-to-end over real Tesseract output from a real screenshot (tests/fixtures/invoices.png,
 * regenerate with `npm run fixture`). The unit tests use clean synthetic boxes; this one
 * exists because real OCR is messy — split words, typographic dashes, stray punctuation —
 * and that mess is what the heuristics actually have to survive.
 */
const invoices = fixture('invoices')

test('reads the heading as the suggested name', () => {
  assert.equal(suggestTitle(invoices, 1544), 'Invoices')
})

test('finds every secret on the page and nothing else', () => {
  const found = findSensitive(invoices)
  const byKind = found.reduce((acc, m) => ({ ...acc, [m.kind]: (acc[m.kind] ?? 0) + 1 }), {})

  assert.deepEqual(byKind, {
    apiKey: 1,
    creditCard: 3,
    email: 1,
    ipv4: 1,
    phone: 1
  })
})

test('the API key survives OCR reading its hyphen as a dash', () => {
  const key = findSensitive(invoices).find((m) => m.kind === 'apiKey')
  assert.ok(key.text.replace(/-+/g, '-').startsWith('sk-P7xQm2Rv9LbT4kWzYhNc8Ade'.slice(0, 12)))
})

test('no secret is reported twice for the same pixels', () => {
  const found = findSensitive(invoices)
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      const a = found[i].bbox
      const b = found[j].bbox
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      const overlap = w > 0 && h > 0 ? (w * h) / Math.min(a.width * a.height, b.width * b.height) : 0
      assert.ok(overlap <= 0.6, `${found[i].kind} and ${found[j].kind} cover the same region`)
    }
  }
})

test('extracts the invoice table exactly', () => {
  const table = detectTable(invoices)
  assert.ok(table, 'expected a table')
  assert.equal(table.columns, 5)
  assert.equal(table.rows.length, 4)
  assert.deepEqual(table.rows[0], ['INVOICE', 'CUSTOMER', 'CARD', 'AMOUNT', 'STATUS'])
  assert.deepEqual(table.rows[1].slice(0, 2), ['INV-20841', 'Marcus Bell'])
  assert.deepEqual(table.rows[2].slice(0, 2), ['INV-20842', 'Priya Raman'])
  assert.deepEqual(table.rows[3].slice(0, 2), ['INV-20843', 'Toby Alvarez'])
  assert.equal(table.rows[1][3], '$1,240.00')
})

test('finds the link, the amounts and the brand colour', () => {
  const entities = extractEntities(invoices)
  const of = (kind) => entities.filter((e) => e.kind === kind).map((e) => e.text)

  assert.deepEqual(of('url'), ['https://docs.northgate-labs.com/api/v2'])
  assert.deepEqual(of('money').sort(), ['$1,240.00', '$318.50', '$96.00'])
  assert.deepEqual(of('color'), ['#4F8CFF'])
  assert.deepEqual(of('ip'), ['10.42.18.203'])
})

test('does not mistake the card numbers for phone numbers', () => {
  const phones = extractEntities(invoices).filter((e) => e.kind === 'phone')
  assert.equal(phones.length, 1)
  assert.equal(phones[0].text.replace(/\s+/g, ' '), '+1 415 555 0182')
})
