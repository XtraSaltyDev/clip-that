import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from './helpers.mjs'

const { parseByteRange } = await load('src/main/protocol/byte-range.js')

test('parses open, closed and suffix byte ranges', () => {
  assert.deepEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19 })
  assert.deepEqual(parseByteRange('bytes=10-', 100), { start: 10, end: 99 })
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 })
  assert.deepEqual(parseByteRange('bytes=90-999', 100), { start: 90, end: 99 })
  assert.equal(parseByteRange(null, 100), null)
})

test('rejects unsafe and unsupported ranges', () => {
  for (const value of ['bytes=100-', 'bytes=20-10', 'bytes=-0', 'items=1-2', 'bytes=0-1,3-4']) {
    assert.equal(parseByteRange(value, 100), 'invalid', value)
  }
})
