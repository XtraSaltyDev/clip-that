import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { supportsSystemAudio } = await load('systemAudio')

test('system audio support follows the native platform capability', () => {
  assert.equal(supportsSystemAudio('darwin', '26.6.1'), true)
  assert.equal(supportsSystemAudio('darwin', '13.0'), true)
  assert.equal(supportsSystemAudio('darwin', '12.7.6'), false)
  assert.equal(supportsSystemAudio('win32'), true)
  assert.equal(supportsSystemAudio('linux'), true)
  assert.equal(supportsSystemAudio('freebsd'), false)
})

test('system audio support fails closed when the macOS version is unavailable', () => {
  assert.equal(supportsSystemAudio('darwin'), false)
  assert.equal(supportsSystemAudio('darwin', 'unknown'), false)
})
