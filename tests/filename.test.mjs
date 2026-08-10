import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { defaultSettings, formatFilename, migrateAfterCapturePreference, safeFilename } =
  await load('defaults')

const AT = new Date(2026, 7, 6, 9, 4, 5, 70) // 6 Aug 2026, 09:04:05.070

test('expands every date token', () => {
  assert.equal(formatFilename('{yyyy}-{MM}-{dd} at {HH}.{mm}.{ss}', AT), '2026-08-06 at 09.04.05')
  assert.equal(formatFilename('{yy}{ms}', AT), '26070')
})

test('drops unknown tokens instead of writing placeholder syntax into filenames', () => {
  assert.equal(formatFilename('shot-{nope}{bad-token}', AT), 'shot-')
})

test('strips characters that are illegal in a filename on any platform', () => {
  const out = formatFilename('a/b\\c:d*e?f"g<h>i|j', AT)
  assert.ok(!/[\\/:*?"<>|]/.test(out))
})

test('falls back to a usable name when the template empties out', () => {
  assert.equal(formatFilename('///', AT), 'ClipThat')
  assert.equal(formatFilename('', AT), 'ClipThat')
})

test('keeps literal text around the tokens', () => {
  assert.equal(formatFilename('Bug report {yyyy}', AT), 'Bug report 2026')
})

test('removes control characters, trailing dots, and Windows device names', () => {
  assert.equal(safeFilename('report\u0000name... '), 'report-name')
  assert.equal(safeFilename('CON.txt'), 'ClipThat-CON.txt')
  assert.equal(safeFilename('lpt9'), 'ClipThat-lpt9')
})

test('caps generated names to a filesystem-friendly length', () => {
  assert.equal(safeFilename('a'.repeat(400)).length, 180)
})

test('asks before replacing an existing editor by default', () => {
  assert.equal(defaultSettings('/tmp').libraryOpenBehavior, 'ask')
})

test('opens new captures in the editor by default', () => {
  assert.equal(defaultSettings('/tmp').afterCapture, 'editor')
})

test('migrates the removed Quick Access preference to the editor workflow', () => {
  assert.equal(migrateAfterCapturePreference('quickAccess'), 'editor')
  assert.equal(migrateAfterCapturePreference('pipeline'), 'pipeline')
})
