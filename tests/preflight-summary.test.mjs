import test from 'node:test'
import assert from 'node:assert/strict'

const { capabilityStateLabel, recordingReadiness } =
  await import('../.cache/test/src/renderer/hud/preflight-summary.js')

const item = (id, state, detail = state) => ({ id, label: id, state, detail })

test('recording readiness keeps technical detail progressive and never reports false green', () => {
  const ready = recordingReadiness([item('source', 'supported')], true)
  assert.equal(ready.tone, 'ready')
  assert.equal(ready.actionItems.length, 0)

  const warning = recordingReadiness([item('source', 'unverified')], true)
  assert.equal(warning.tone, 'warning')
  assert.deepEqual(
    warning.actionItems.map((entry) => entry.id),
    ['source']
  )

  const blocked = recordingReadiness(
    [item('source', 'permission-error'), item('ffmpeg', 'unavailable')],
    false
  )
  assert.equal(blocked.tone, 'blocked')
  assert.deepEqual(
    blocked.actionItems.map((entry) => entry.id),
    ['source', 'ffmpeg']
  )

  const incomplete = recordingReadiness([], false)
  assert.equal(incomplete.title, 'Recording is not ready')
  assert.equal(incomplete.actionItems.length, 0)
})

test('capability state labels pair colour with plain language', () => {
  assert.equal(capabilityStateLabel('supported'), 'Ready')
  assert.equal(capabilityStateLabel('unverified'), 'Unverified')
  assert.equal(capabilityStateLabel('permission-error'), 'Permission needed')
  assert.equal(capabilityStateLabel('device-error'), 'Device error')
})
