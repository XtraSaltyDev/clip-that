import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { selfTestExitCode } = await load('selfTestExit')

test('self-test exit status is nonzero for empty or failed results', () => {
  assert.equal(selfTestExitCode([]), 1)
  assert.equal(selfTestExitCode([['editor', false]]), 1)
  assert.equal(
    selfTestExitCode([
      ['editor', true],
      ['controlled failure', false]
    ]),
    1
  )
})

test('self-test exit status is zero only when every phase passes', () => {
  assert.equal(selfTestExitCode([['editor', true]]), 0)
  assert.equal(
    selfTestExitCode([
      ['editor', true],
      ['layout', true]
    ]),
    0
  )
})
