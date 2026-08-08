import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { load } from './helpers.mjs'

const validation = await load('ipcValidation')
const { isPathInside } = await load('pathGuard')
const { defaultSettings } = await load('defaults')

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
  assert.deepEqual(
    validation.libraryPatch({
      videoEdit: { startMs: 100, endMs: 900, format: 'mp4', quality: 'high', updatedAt: 123 }
    }).videoEdit,
    { startMs: 100, endMs: 900, format: 'mp4', quality: 'high', updatedAt: 123 }
  )
  assert.throws(
    () => validation.libraryPatch({
      videoEdit: { startMs: 900, endMs: 100, format: 'mp4', quality: 'high', updatedAt: 123 }
    }),
    /trim end/
  )
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

test('recording chunk IPC accepts bounded ordered WebM slices', () => {
  assert.deepEqual(validation.recordingChunkBytes(new Uint8Array([1, 2])), new Uint8Array([1, 2]))
  assert.equal(validation.recordingSequence(42), 42)
  assert.equal(validation.recordingMimeType('video/webm;codecs=vp9'), 'video/webm;codecs=vp9')
  assert.throws(() => validation.recordingSequence(1.5), /integer/)
  assert.throws(() => validation.recordingChunkBytes(new Uint8Array()), /empty/)
  assert.throws(() => validation.recordingMimeType('video/mp4'), /WebM/)
})

test('settings IPC accepts only known, bounded fields', () => {
  const current = defaultSettings('/tmp/ClipThat')
  assert.deepEqual(validation.settingsPatch({ theme: 'dark', jpegQuality: 80 }, current), {
    theme: 'dark',
    jpegQuality: 80
  })
  assert.equal(
    validation.settingsPatch({ hotkeys: { captureRegion: 'Command+1' } }, current).hotkeys.captureRegion,
    'Command+1'
  )
  assert.throws(() => validation.settingsPatch({ arbitraryCommand: 'open /tmp' }, current), /not supported/)
  assert.throws(() => validation.settingsPatch({ pipeline: { uploadToken: 'secret' } }, current), /not supported/)
  assert.throws(() => validation.settingsPatch({ accent: 'url(javascript:1)' }, current), /hex colour/)
})

test('overlay and system messages reject extra fields and unsafe schemes', () => {
  assert.deepEqual(
    validation.overlaySelection({
      displayId: '1',
      mode: 'region',
      rect: { x: 0, y: 0, width: 10, height: 10 },
      screenRect: { x: 0, y: 0, width: 5, height: 5 }
    }).mode,
    'region'
  )
  assert.throws(
    () => validation.overlaySelection({
      displayId: '1',
      mode: 'region',
      rect: { x: 0, y: 0, width: 10, height: 10 },
      screenRect: { x: 0, y: 0, width: 5, height: 5 },
      restoreEditorWindows: true
    }),
    /not supported/
  )
  assert.throws(() => validation.externalUrl('javascript:alert(1)'), /HTTP or HTTPS/)
  assert.throws(() => validation.toastValue({ kind: 'success', message: 'ok', html: '<b>x</b>' }), /not supported/)
})

test('path containment does not accept sibling prefixes or traversal', () => {
  const root = resolve('/tmp/clipthat-library')
  assert.equal(isPathInside(root, resolve(root, 'captures', 'a.png')), true)
  assert.equal(isPathInside(root, resolve('/tmp/clipthat-library-other/a.png')), false)
  assert.equal(isPathInside(root, resolve(root, '..', 'outside.png')), false)
  assert.equal(isPathInside(root, 'relative.png'), false)
})
