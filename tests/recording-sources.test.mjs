import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { reconcileRecordingSources } = await load('recordingSources')

const displays = [
  { id: 'primary', primary: true },
  { id: 'external', primary: false }
]
const windows = [{ id: 'window:42:0' }]

function options(patch = {}) {
  return {
    target: 'display',
    autoZoom: false,
    zoomLevel: 1.6,
    fps: 30,
    microphone: false,
    systemAudio: false,
    webcam: false,
    webcamPosition: 'br',
    webcamSize: 220,
    countdown: 3,
    ...patch
  }
}

test('replaces stale persisted source IDs with the live primary display', () => {
  assert.deepEqual(
    reconcileRecordingSources(
      options({ displayId: 'gone', windowId: 'window:gone:0' }),
      displays,
      windows
    ),
    options({ displayId: 'primary', windowId: undefined })
  )
})

test('preserves source IDs that are still offered by Electron', () => {
  const current = options({ target: 'window', displayId: 'external', windowId: 'window:42:0' })
  assert.deepEqual(reconcileRecordingSources(current, displays, windows), current)
})
