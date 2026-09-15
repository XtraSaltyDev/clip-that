import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultSettings } from '../.cache/test/src/shared/defaults.js'
import { normalizeHotkeyKey, planHotkeyBindings } from '../.cache/test/src/shared/hotkey-plan.js'
import { welcomeCaptureReady } from '../.cache/test/src/shared/onboarding.js'

test('duplicate ClipThat accelerators are reported instead of silently skipped', () => {
  const keys = defaultSettings('/tmp').hotkeys
  keys.captureWindow = keys.captureRegion
  const planned = planHotkeyBindings(keys)
  assert.ok(planned.bindings.some((binding) => binding.action === 'captureRegion'))
  assert.deepEqual(planned.failures, [{ action: 'captureWindow', accelerator: keys.captureRegion }])
  assert.equal(
    planned.bindings.some((binding) => binding.action === 'captureWindow'),
    false
  )
})

test('duplicate Command+Shift+Z bindings are reported instead of silently accepted', () => {
  const keys = defaultSettings('/tmp').hotkeys
  keys.captureRegion = 'Command+Shift+Z'
  keys.captureWindow = 'Command+Shift+Z'
  const planned = planHotkeyBindings(keys)
  assert.ok(planned.bindings.some((binding) => binding.action === 'captureRegion'))
  assert.deepEqual(planned.failures, [{ action: 'captureWindow', accelerator: 'Command+Shift+Z' }])
})

test('empty accelerators are ignored and unique shortcuts still bind', () => {
  const keys = defaultSettings('/tmp').hotkeys
  keys.grabText = ''
  const planned = planHotkeyBindings(keys)
  assert.equal(planned.failures.length, 0)
  assert.equal(
    planned.bindings.some((binding) => binding.action === 'grabText'),
    false
  )
  assert.ok(planned.bindings.some((binding) => binding.action === 'openLibrary'))
})

test('welcome capture actions wait for a verified macOS screen grant', () => {
  assert.equal(welcomeCaptureReady('darwin', undefined), false)
  assert.equal(welcomeCaptureReady('darwin', false), false)
  assert.equal(welcomeCaptureReady('darwin', true), true)
  assert.equal(welcomeCaptureReady('win32', false), true)
  assert.equal(welcomeCaptureReady('linux', undefined), true)
})

test('macOS Option and shifted digits retain bindable accelerator key names', () => {
  assert.equal(normalizeHotkeyKey({ key: '·', code: 'Digit9', altKey: true, shiftKey: true }), '9')
  assert.equal(normalizeHotkeyKey({ key: 'π', code: 'KeyP', altKey: true, shiftKey: false }), 'P')
  assert.equal(
    normalizeHotkeyKey({ key: 'Dead', code: 'KeyE', altKey: true, shiftKey: false }),
    'E'
  )
  assert.equal(normalizeHotkeyKey({ key: '#', code: 'Digit3', altKey: false, shiftKey: true }), '3')
})

test('ordinary letters respect the typed layout and named keys keep their accelerator forms', () => {
  const key = (key, code = '') => normalizeHotkeyKey({ key, code, altKey: false, shiftKey: false })
  assert.equal(key('a', 'KeyQ'), 'A')
  assert.equal(key('ArrowLeft'), 'Left')
  assert.equal(key(' '), 'Space')
  assert.equal(key('Enter'), 'Return')
  assert.equal(key('F12'), 'F12')
  assert.equal(key('Alt'), null)
})
