import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { shouldIncludeWindowSource } = await load('windowSources')

test('keeps visible ClipThat editors in the window picker', () => {
  assert.equal(shouldIncludeWindowSource('ClipThat', ['ClipThat']), true)
  assert.equal(shouldIncludeWindowSource('ClipThat — ClipThat', ['ClipThat']), true)
  assert.equal(shouldIncludeWindowSource('ClipThat — invoice.png', ['invoice.png']), true)
  assert.equal(
    shouldIncludeWindowSource(
      'ClipThat',
      ['ClipThat Recording Sentinel'],
      'window:42:0',
      ['window:42:0']
    ),
    true
  )
  assert.equal(
    shouldIncludeWindowSource(
      'ClipThat',
      ['ClipThat Recording Sentinel'],
      'window:42:0',
      ['window:42:7']
    ),
    true
  )
})

test('still excludes internal ClipThat windows', () => {
  const editorTitles = ['ClipThat']
  assert.equal(shouldIncludeWindowSource('ClipThat Capture', editorTitles), false)
  assert.equal(shouldIncludeWindowSource('ClipThat Library', editorTitles), false)
  assert.equal(shouldIncludeWindowSource('ClipThat Recorder', editorTitles), false)
  assert.equal(shouldIncludeWindowSource('ClipThat Settings', editorTitles), false)
  assert.equal(
    shouldIncludeWindowSource('ClipThat', ['ClipThat Recording Sentinel'], 'window:43:0', [
      'window:42:7'
    ]),
    false
  )
})

test('keeps other applications and rejects empty sources', () => {
  assert.equal(shouldIncludeWindowSource('Safari — Release notes', []), true)
  assert.equal(shouldIncludeWindowSource('  ', ['ClipThat']), false)
})
