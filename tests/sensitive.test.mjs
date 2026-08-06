import test from 'node:test'
import assert from 'node:assert/strict'
import { load, line, ocr } from './helpers.mjs'

const { findSensitive, SENSITIVE_LABELS } = await load('extract')

const kinds = (result) => findSensitive(result).map((m) => m.kind)
const texts = (result) => findSensitive(result).map((m) => m.text)

test('finds an email address', () => {
  const result = ocr(line('Owner: dana.whitfield@northgate-labs.com', { y: 0 }))
  assert.deepEqual(kinds(result), ['email'])
  assert.equal(texts(result)[0], 'dana.whitfield@northgate-labs.com')
})

test('finds a Luhn-valid card number split across words', () => {
  const result = ocr(line('Card: 4539 1488 0343 6467', { y: 0 }))
  assert.ok(kinds(result).includes('creditCard'))
  assert.equal(
    findSensitive(result).find((m) => m.kind === 'creditCard').text,
    '4539 1488 0343 6467'
  )
})

test('rejects a 16-digit number that fails the Luhn check', () => {
  const result = ocr(line('Order 1234 5678 9012 3456', { y: 0 }))
  assert.ok(!kinds(result).includes('creditCard'))
})

test('a card number is not also reported as a phone number', () => {
  // The card contains a run of digits that matches the phone pattern exactly;
  // only the stronger detector should survive.
  const result = ocr(line('Card: 4539 1488 0343 6467', { y: 0 }))
  assert.ok(!kinds(result).includes('phone'))
})

test('finds a real phone number when no card is competing', () => {
  const result = ocr(line('Support line: +1 415 555 0182', { y: 0 }))
  assert.ok(kinds(result).includes('phone'))
  assert.equal(findSensitive(result).find((m) => m.kind === 'phone').text, '+1 415 555 0182')
})

test('finds an API key even when OCR read the hyphen as an em dash', () => {
  const result = ocr(line('Secret key: sk—P7xQm2Rv9LbT4kWzYhNc8Ade', { y: 0 }))
  assert.ok(kinds(result).includes('apiKey'))
})

test('finds well-known provider key formats', () => {
  for (const key of [
    'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
    'AKIAIOSFODNN7EXAMPLE',
    'xoxb-1234567890-abcdefghij'
  ]) {
    const result = ocr(line(`token ${key}`, { y: 0 }))
    assert.ok(kinds(result).includes('apiKey'), `expected ${key} to be detected`)
  }
})

test('finds a JWT', () => {
  const jwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r0'
  assert.ok(kinds(ocr(line(`auth ${jwt}`, { y: 0 }))).includes('jwt'))
})

test('finds an IPv4 address but rejects an impossible one', () => {
  assert.ok(kinds(ocr(line('Server: 10.42.18.203', { y: 0 }))).includes('ipv4'))
  assert.ok(!kinds(ocr(line('Version 999.1.1.1', { y: 0 }))).includes('ipv4'))
})

test('finds a social security number', () => {
  assert.ok(kinds(ocr(line('SSN 123-45-6789', { y: 0 }))).includes('ssn'))
})

test('ignores ordinary prose', () => {
  const result = ocr(
    line('The quick brown fox jumps over the lazy dog', { y: 0 }),
    line('Nothing to see here at all today', { y: 40 })
  )
  assert.deepEqual(findSensitive(result), [])
})

test('every detected kind has a human label', () => {
  const result = ocr(
    line('mail a@b.co', { y: 0 }),
    line('ip 10.0.0.1', { y: 40 }),
    line('card 4539 1488 0343 6467', { y: 80 })
  )
  for (const match of findSensitive(result)) {
    assert.ok(SENSITIVE_LABELS[match.kind], `missing label for ${match.kind}`)
  }
})

test('returns a box that covers every word of the match', () => {
  const result = ocr(line('Card: 4539 1488 0343 6467', { y: 0 }))
  const card = findSensitive(result).find((m) => m.kind === 'creditCard')
  // "4539" starts after "Card:" (6 chars incl. space) at 6*8 = 48.
  assert.equal(card.bbox.x, 48)
  assert.equal(card.bbox.width, 8 * 19, 'box should span all four digit groups')
})
