import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { hasUsableRecordingExport } = await import('../.cache/test/src/shared/recording-exports.js')

test('recording preflight requires at least one encoder-backed export', () => {
  assert.equal(hasUsableRecordingExport({ mp4: false, webm: false, gif: false }), false)
  assert.equal(hasUsableRecordingExport({ mp4: true, webm: false, gif: false }), true)
  assert.equal(hasUsableRecordingExport({ mp4: false, webm: true, gif: false }), true)
  assert.equal(hasUsableRecordingExport({ mp4: false, webm: false, gif: true }), true)
})

test('the embedded product version comes from package metadata', async () => {
  const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  const source = await readFile(new URL('../src/main/product-version.ts', import.meta.url), 'utf8')
  assert.match(source, /packageMetadata\.version/)
  assert.doesNotMatch(source, new RegExp(`['\"]${packageMetadata.version}['\"]`))
})

test('recording accessibility announces state changes without making the timer live', async () => {
  const source = await readFile(
    new URL('../src/renderer/hud/Recorder.tsx', import.meta.url),
    'utf8'
  )
  assert.match(source, /hud-recording-state" role="status" aria-live="polite"/)
  assert.match(source, /hud-time mono" aria-live="off"/)
  assert.doesNotMatch(source, /hud-bar drag-region" role="status"/)
  for (const label of ['Top left', 'Top right', 'Bottom left', 'Bottom right']) {
    assert.match(source, new RegExp(`ariaLabel: '${label}'`))
  }
})

test('segmented tips describe options instead of replacing their visible name', async () => {
  const source = await readFile(new URL('../src/renderer/shared/ui.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /aria-label=\{o\.tip\}/)
  assert.match(source, /aria-describedby=\{descriptionId\}/)
})
