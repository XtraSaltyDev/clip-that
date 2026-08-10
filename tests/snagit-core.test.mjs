import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, rm, symlink, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { load } from './helpers.mjs'

const { scanSnagitFolder, summarizeSnagitScan, classifySnagitExtension } = await load('snagitCore')

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

test('Snagit scan recurses, classifies native/unsupported files, skips symlinks, and preserves the source', async () => {
  const root = join(tmpdir(), `clipthat-snagit-${Date.now()}-${Math.random()}`)
  const nested = join(root, 'Cloud export', 'Nested')
  try {
    await mkdir(nested, { recursive: true })
    const imageBytes = Buffer.from('valid image bytes')
    const duplicateBytes = Buffer.from('same image bytes')
    await writeFile(join(root, 'capture.png'), imageBytes)
    await writeFile(join(nested, 'same.jpg'), duplicateBytes)
    await writeFile(join(nested, 'same-again.webp'), duplicateBytes)
    await writeFile(join(root, 'recording.mp4'), Buffer.from('valid video bytes'))
    await writeFile(join(root, 'editable.snagx'), 'native project')
    await mkdir(join(root, 'bundle.snagarchive'))
    await writeFile(join(root, 'bundle.snagarchive', 'hidden.png'), 'must not be scanned')
    await writeFile(join(root, 'notes.txt'), 'unsupported')
    await writeFile(join(root, 'broken.png'), 'broken')
    await symlink(join(root, 'capture.png'), join(root, 'linked.png'))
    await symlink(nested, join(root, 'linked-folder'))

    const before = await readFile(join(root, 'capture.png'))
    const scan = await scanSnagitFolder(root, {
      inspectImage: async (filePath) => {
        if (filePath.endsWith('broken.png')) throw new Error('decode failed')
        return { width: 100, height: 80 }
      },
      inspectVideo: async () => ({ width: 1280, height: 720, durationMs: 1_500 })
    }, new Set([`image:${hash(duplicateBytes)}`]))
    const summary = summarizeSnagitScan(scan)

    assert.equal(summary.counts.supported, 2)
    assert.equal(summary.counts.duplicates, 2)
    assert.equal(summary.counts.nativeProjects, 2)
    assert.equal(summary.counts.unsupported, 3)
    assert.equal(summary.counts.unreadable, 1)
    assert.equal(scan.files.find((file) => file.name === 'same.jpg').category, 'duplicates')
    assert.equal(scan.files.find((file) => file.name === 'same-again.webp').category, 'duplicates')
    assert.equal(scan.files.find((file) => file.name === 'recording.mp4').durationMs, 1_500)
    assert.equal((await readFile(join(root, 'capture.png'))).equals(before), true)
    assert.equal((await lstat(join(root, 'linked.png'))).isSymbolicLink(), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Snagit scan uses filename and reliable file times, and copied imports do not move the source', async () => {
  const root = join(tmpdir(), `clipthat-snagit-${Date.now()}-${Math.random()}`)
  const destination = join(tmpdir(), `clipthat-import-${Date.now()}-${Math.random()}.png`)
  try {
    await mkdir(root, { recursive: true })
    const source = join(root, 'screen shot.png')
    await writeFile(source, 'bytes')
    const scan = await scanSnagitFolder(root, {
      inspectImage: async () => ({ width: 10, height: 20 }),
      inspectVideo: async () => ({ width: 10, height: 20, durationMs: 100 })
    })
    const file = scan.files[0]
    assert.equal(file.name, 'screen shot.png')
    assert.ok(file.createdAt > 0)
    assert.ok(file.updatedAt > 0)
    await copyFile(source, destination)
    assert.equal((await readFile(source, 'utf8')), 'bytes')
    assert.equal((await readFile(destination, 'utf8')), 'bytes')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(destination, { force: true })
  }
})

test('Snagit extension classifier keeps native projects out of ordinary media', () => {
  assert.deepEqual(classifySnagitExtension('.snagx'), { category: 'nativeProjects' })
  assert.deepEqual(classifySnagitExtension('.gif'), { category: 'unsupported' })
  assert.deepEqual(classifySnagitExtension('.mp4'), { category: 'candidate', kind: 'video' })
})
