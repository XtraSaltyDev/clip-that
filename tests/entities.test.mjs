import test from 'node:test'
import assert from 'node:assert/strict'
import { load, line, ocr } from './helpers.mjs'

const { extractEntities } = await load('extract')

const find = (result, kind) => extractEntities(result).filter((e) => e.kind === kind)

test('finds an http link', () => {
  const [link] = find(ocr(line('Docs: https://docs.example.com/api/v2', { y: 0 })), 'url')
  assert.equal(link.text, 'https://docs.example.com/api/v2')
  assert.equal(link.value, undefined)
})

test('normalises a bare www link into an openable URL', () => {
  const [link] = find(ocr(line('Visit www.example.com/pricing', { y: 0 })), 'url')
  assert.equal(link.text, 'www.example.com/pricing')
  assert.equal(link.value, 'https://www.example.com/pricing')
})

test('finds emails, money, colours and dates', () => {
  const result = ocr(
    line('Mail dana@example.com', { y: 0 }),
    line('Total $1,240.00', { y: 40 }),
    line('Brand #4F8CFF', { y: 80 }),
    line('Due 2026-08-06', { y: 120 })
  )
  assert.equal(find(result, 'email')[0].text, 'dana@example.com')
  assert.equal(find(result, 'money')[0].text, '$1,240.00')
  assert.equal(find(result, 'color')[0].text, '#4F8CFF')
  assert.equal(find(result, 'date')[0].text, '2026-08-06')
})

test('does not report a card number as a phone number', () => {
  const result = ocr(line('Card 4539 1488 0343 6467', { y: 0 }))
  assert.deepEqual(find(result, 'phone'), [])
})

test('does report a genuine phone number', () => {
  const result = ocr(line('Call +1 415 555 0182 today', { y: 0 }))
  assert.equal(find(result, 'phone').length, 1)
})

test('deduplicates the same value seen twice on one line', () => {
  const result = ocr(line('a@b.co and a@b.co', { y: 0 }))
  assert.equal(find(result, 'email').length, 1)
})

test('every entity carries a box inside the source line', () => {
  const result = ocr(line('Server 10.0.0.1 online', { y: 100 }))
  const [ip] = find(result, 'ip')
  assert.equal(ip.bbox.y, 100)
  assert.equal(ip.bbox.x, 7 * 8)
})

test('returns nothing for prose', () => {
  assert.deepEqual(extractEntities(ocr(line('just some ordinary words here', { y: 0 }))), [])
})
