import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from './helpers.mjs'

const { editorCopyTarget } = await load('src/renderer/editor/clipboard-intent.js')

test('editor copy prioritizes Live Text, then selected annotations, then the image', () => {
  assert.equal(editorCopyTarget(true, 2), 'text')
  assert.equal(editorCopyTarget(false, 2), 'annotations')
  assert.equal(editorCopyTarget(false, 0), 'image')
})
