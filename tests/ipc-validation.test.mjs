import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { load } from './helpers.mjs'

const validation = await load('ipcValidation')
const { isPathInside } = await load('pathGuard')

test('library patches expose only user-editable fields', () => {
  assert.deepEqual(validation.libraryPatch({ title: ' New title ', favorite: true }), {
    title: ' New title ',
    favorite: true
  })
  assert.throws(
    () => validation.libraryPatch({ filePath: '/tmp/replaced.png' }),
    /cannot be changed/
  )
  assert.throws(() => validation.libraryPatch({ tags: new Array(51).fill('tag') }), /tags/)
})

test('image payloads require an allowed base64 data URL', () => {
  assert.equal(validation.imageDataUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
  assert.throws(() => validation.imageDataUrl('file:///etc/passwd'), /data URL/)
  assert.throws(() => validation.imageDataUrl('data:text/html;base64,AAAA'), /data URL/)
})

test('capture and recording options reject unsupported values', () => {
  assert.throws(() => validation.captureRequest({ mode: 'everything' }), /not supported/)
  assert.throws(
    () => validation.recordingOptions({ target: 'display', fps: 120 }),
    /outside the supported range/
  )
})

test('path containment does not accept sibling prefixes or traversal', () => {
  const root = resolve('/tmp/clipthat-library')
  assert.equal(isPathInside(root, resolve(root, 'captures', 'a.png')), true)
  assert.equal(isPathInside(root, resolve('/tmp/clipthat-library-other/a.png')), false)
  assert.equal(isPathInside(root, resolve(root, '..', 'outside.png')), false)
  assert.equal(isPathInside(root, 'relative.png'), false)
})
