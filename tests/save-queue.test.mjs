import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from './helpers.mjs'

const { SaveQueue } = await load('src/renderer/shared/save-queue.js')
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('autosave serializes writes and does not replace newer typing with an older response', async () => {
  const first = deferred()
  const calls = [],
    displayed = []
  const queue = new SaveQueue(
    async (value) => {
      calls.push(value)
      if (value === 'first') await first.promise
      return value
    },
    (value) => displayed.push(value)
  )
  queue.enqueue('first')
  const flush = queue.flush()
  queue.enqueue('second')
  queue.enqueue('last keystroke')
  assert.deepEqual(calls, ['first'])
  assert.equal(queue.dirty, true)
  first.resolve()
  await flush
  assert.deepEqual(calls, ['first', 'last keystroke'])
  assert.deepEqual(displayed, ['last keystroke'])
  assert.equal(queue.dirty, false)
})

test('navigation waits for an in-flight write and the newest queued draft', async () => {
  const first = deferred(),
    last = deferred()
  const queue = new SaveQueue(
    (value) => (value === 1 ? first.promise : last.promise),
    () => {}
  )
  queue.enqueue(1)
  const autosave = queue.flush()
  queue.enqueue(2)
  let left = false
  const leave = queue.flush().then(() => {
    left = true
  })
  first.resolve(1)
  await Promise.resolve()
  assert.equal(left, false)
  last.resolve(2)
  await Promise.all([autosave, leave])
  assert.equal(left, true)
  assert.equal(queue.dirty, false)
})

test('failed writes preserve the latest draft and a retry can finish without retyping', async () => {
  const failure = deferred()
  let fail = true
  const displayed = []
  const queue = new SaveQueue(
    async (value) => {
      if (fail) await failure.promise
      return value
    },
    (value) => displayed.push(value)
  )
  queue.enqueue('old')
  const flush = queue.flush()
  queue.enqueue('keep this draft')
  failure.reject(new Error('Disk full'))
  await assert.rejects(flush, /Disk full/)
  assert.equal(queue.dirty, true)
  assert.deepEqual(displayed, [])
  fail = false
  await queue.flush()
  assert.deepEqual(displayed, ['keep this draft'])
  assert.equal(queue.dirty, false)
})

test('a failure without newer edits retains the same draft', async () => {
  let fail = true
  const saved = []
  const queue = new SaveQueue(
    async (value) => {
      if (fail) throw new Error('Permission denied')
      return value
    },
    (value) => saved.push(value)
  )
  queue.enqueue('draft')
  const version = queue.version
  await assert.rejects(queue.flush(), /Permission denied/)
  fail = false
  await queue.flush()
  assert.deepEqual(saved, ['draft'])
  assert.equal(queue.version, version)
})
