import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { load } from './helpers.mjs'

const { atomicFileWrite } = await load('src/main/store/atomic-file.js')
const { imageFormatForPath, assertImageFormatMatchesPath } = await load(
  'src/shared/image-format.js'
)

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'clipthat-save-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const target = join(root, 'capture.png')
  await fs.writeFile(target, 'previous capture')
  return { root, target }
}

test('linked filenames retain their format across default-format changes on Mac and Windows', () => {
  for (const [path, expected] of [
    ['/Users/test/Capture.PNG', 'png'],
    ['/Users/test/Capture.jpeg', 'jpg'],
    ['C:\\Users\\test\\Capture.JPG', 'jpg'],
    ['C:\\Users\\test\\Capture.WeBp', 'webp']
  ]) {
    for (const fallback of ['png', 'jpg', 'webp']) {
      assert.equal(imageFormatForPath(path) ?? fallback, expected)
    }
  }
  for (const path of [
    null,
    undefined,
    '',
    '/tmp/png',
    '/tmp/a.jpg/capture',
    '/tmp/capture.custom'
  ]) {
    assert.equal(imageFormatForPath(path), undefined)
  }
})

test('an incompatible filename is rejected before any image overwrite', () => {
  assert.throws(() => assertImageFormatMatchesPath('/tmp/keep.jpeg', 'png'), /Choose a .png/)
  assert.throws(() => assertImageFormatMatchesPath('C:\\keep.webp', 'jpg'), /export as WEBP/)
  assert.doesNotThrow(() => assertImageFormatMatchesPath('/tmp/keep.JPEG', 'jpg'))
  assert.doesNotThrow(() => assertImageFormatMatchesPath('/tmp/custom', 'png'))
})

test('complete binary and project saves replace the file without leaving staging files', async (t) => {
  const { root, target } = await fixture(t)
  const bytes = Buffer.from([0, 1, 255, 42])
  await atomicFileWrite(target, bytes)
  assert.deepEqual(await fs.readFile(target), bytes)
  const project = join(root, 'project.clipthat')
  await atomicFileWrite(project, JSON.stringify({ title: 'New capture' }))
  assert.deepEqual(JSON.parse(await fs.readFile(project, 'utf8')), { title: 'New capture' })
  assert.deepEqual((await fs.readdir(root)).sort(), ['capture.png', 'project.clipthat'])
})

test('a partial staging write leaves the previous capture intact and removes the partial file', async (t) => {
  const { root, target } = await fixture(t)
  const open = fs.open.bind(fs)
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args)
    const write = handle.writeFile.bind(handle)
    t.mock.method(handle, 'writeFile', async () => {
      await write('partial bytes')
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    })
    return handle
  })
  await assert.rejects(atomicFileWrite(target, 'new capture'), /disk full/)
  assert.equal(await fs.readFile(target, 'utf8'), 'previous capture')
  assert.deepEqual(await fs.readdir(root), ['capture.png'])
})

test('a failed flush preserves the old file and cleans up staging', async (t) => {
  const { root, target } = await fixture(t)
  const open = fs.open.bind(fs)
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args)
    t.mock.method(handle, 'sync', async () => {
      throw new Error('flush failed')
    })
    return handle
  })
  await assert.rejects(atomicFileWrite(target, 'new capture'), /flush failed/)
  assert.equal(await fs.readFile(target, 'utf8'), 'previous capture')
  assert.deepEqual(await fs.readdir(root), ['capture.png'])
})

test('a failed replacement preserves the old file and cleans up staging', async (t) => {
  const { root, target } = await fixture(t)
  t.mock.method(fs, 'rename', async () => {
    throw new Error('destination unavailable')
  })
  await assert.rejects(atomicFileWrite(target, 'new capture'), /destination unavailable/)
  assert.equal(await fs.readFile(target, 'utf8'), 'previous capture')
  assert.deepEqual(await fs.readdir(root), ['capture.png'])
})

test(
  'existing file permissions and symbolic links are preserved',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { root, target } = await fixture(t)
    await fs.chmod(target, 0o600)
    const link = join(root, 'linked.png')
    await fs.symlink(target, link)
    await atomicFileWrite(link, 'new capture')
    assert.equal(await fs.readFile(target, 'utf8'), 'new capture')
    assert.equal((await fs.stat(target)).mode & 0o777, 0o600)
    assert.equal((await fs.lstat(link)).isSymbolicLink(), true)
    await fs.rm(target)
    await assert.rejects(atomicFileWrite(link, 'keep dangling link'), { code: 'ENOENT' })
    assert.equal((await fs.lstat(link)).isSymbolicLink(), true)
  }
)

test('invalid destinations are reported without leaving staging files', async (t) => {
  const { root } = await fixture(t)
  await assert.rejects(atomicFileWrite(root, 'capture'), /not a regular file/)
  await assert.rejects(atomicFileWrite(join(root, 'missing', 'capture.png'), 'capture'), {
    code: 'ENOENT'
  })
  assert.deepEqual(await fs.readdir(root), ['capture.png'])
})
