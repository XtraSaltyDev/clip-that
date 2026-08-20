import assert from 'node:assert/strict'
import test from 'node:test'
import { FakeAcceptanceBackend } from './fakes/acceptance-backend.mjs'

test('fake backend covers capture to library to editor without real input devices', () => {
  const backend = new FakeAcceptanceBackend()
  for (const source of ['display:1', 'window:1', 'region:1']) {
    const capture = backend.capture(source)
    assert.equal(backend.edit(capture.id).edited, true)
  }
  assert.equal(backend.library.length, 3)
})

test('fake recorder covers pause, source closure, recoverable failure, and every export format', () => {
  for (const format of ['mp4', 'webm', 'gif']) {
    const backend = new FakeAcceptanceBackend()
    backend.startRecording('window:1')
    backend.pause()
    assert.equal(backend.recordingState, 'paused')
    backend.resume()
    backend.closeSource('window:1')
    assert.equal(backend.recordingState, 'encoding')
    assert.throws(() => backend.exportRecording(format, false), /raw recording was preserved/i)
    assert.equal(backend.rawRecording.length, 1)
    assert.equal(backend.exportRecording(format).format, format)
  }
})
