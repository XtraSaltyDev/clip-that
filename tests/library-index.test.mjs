import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { load } from './helpers.mjs'

const { discoverLibraryFiles, loadLibraryIndex, persistLibraryIndex } = await load('libraryIndex')

function item(id, title) {
  return {
    id,
    title,
    createdAt: 100,
    updatedAt: 100,
    kind: 'image',
    width: 100,
    height: 80,
    filePath: `/captures/${id}.png`,
    thumbnail: `/thumbnails/${id}.png`,
    tags: [],
    favorite: false,
    byteSize: 20
  }
}

test('library index keeps the previous valid generation as an atomic backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-index-'))
  try {
    const primary = join(root, 'index.json')
    const backup = join(root, 'index.json.bak')
    const first = [item('first', 'First')]
    const second = [item('second', 'Second'), ...first]
    persistLibraryIndex(primary, backup, first)
    persistLibraryIndex(primary, backup, second)

    assert.deepEqual(JSON.parse(await readFile(primary, 'utf8')), second)
    assert.deepEqual(JSON.parse(await readFile(backup, 'utf8')), first)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('library index falls back to backup and reports the primary corruption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-index-'))
  try {
    const primary = join(root, 'index.json')
    const backup = join(root, 'index.json.bak')
    await writeFile(primary, '{broken', 'utf8')
    await writeFile(backup, JSON.stringify([item('safe', 'Safe')]), 'utf8')

    const loaded = loadLibraryIndex(primary, backup)
    assert.equal(loaded.source, 'backup')
    assert.equal(loaded.needsRepair, true)
    assert.equal(loaded.items[0].title, 'Safe')
    assert.match(loaded.warning, /restored from its backup/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('library index falls back to backup when the primary is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-index-'))
  try {
    const primary = join(root, 'index.json')
    const backup = join(root, 'index.json.bak')
    await writeFile(backup, JSON.stringify([item('safe', 'Safe')]), 'utf8')

    const loaded = loadLibraryIndex(primary, backup)
    assert.equal(loaded.source, 'backup')
    assert.equal(loaded.needsRepair, true)
    assert.equal(loaded.items[0].title, 'Safe')
    assert.match(loaded.detail, /primary.*missing/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('library index never turns two unreadable generations into a silent healthy result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-index-'))
  try {
    const primary = join(root, 'index.json')
    const backup = join(root, 'index.json.bak')
    await writeFile(primary, '{broken', 'utf8')
    await writeFile(backup, 'also broken', 'utf8')

    const loaded = loadLibraryIndex(primary, backup)
    assert.equal(loaded.source, 'empty')
    assert.equal(loaded.needsRepair, true)
    assert.deepEqual(loaded.items, [])
    assert.match(loaded.warning, /could not be read/)

    const blockedParent = join(root, 'not-a-directory')
    await writeFile(blockedParent, 'file', 'utf8')
    assert.throws(
      () => persistLibraryIndex(join(blockedParent, 'index.json'), backup, []),
      /write failed/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('startup discovery finds supported capture files missing from the index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-index-'))
  try {
    const captures = join(root, 'captures')
    const recordings = join(root, 'recordings')
    await mkdir(captures)
    await mkdir(recordings)
    const indexed = join(captures, 'indexed.png')
    await Promise.all([
      writeFile(indexed, 'png'),
      writeFile(join(captures, 'orphan.webp'), 'webp'),
      writeFile(join(captures, 'ignore.txt'), 'text'),
      writeFile(join(recordings, 'orphan.mp4'), 'video')
    ])

    const files = await discoverLibraryFiles(captures, recordings, [indexed])
    assert.deepEqual(
      files.map((file) => [file.kind, file.filePath.split('/').pop()]),
      [
        ['image', 'orphan.webp'],
        ['video', 'orphan.mp4']
      ]
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
