import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { load } from './helpers.mjs'

const { loadLibraryIndex, persistLibraryIndex } = await load('src/main/store/library-index.js')
const { RecordingRecoveryStore } = await load('src/main/recording/recovery-store.js')

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

test('library index retains an atomic backup and recovers from corruption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-index-'))
  try {
    const primary = join(root, 'index.json')
    const backup = join(root, 'index.json.bak')
    const first = [item('first', 'First')]
    const second = [item('second', 'Second'), ...first]
    persistLibraryIndex(primary, backup, first)
    persistLibraryIndex(primary, backup, second)
    assert.deepEqual(JSON.parse(await readFile(backup, 'utf8')), first)

    await writeFile(primary, '{broken', 'utf8')
    const recovered = loadLibraryIndex(primary, backup)
    assert.equal(recovered.source, 'backup')
    assert.equal(recovered.needsRepair, true)
    assert.equal(recovered.items[0].title, 'First')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('library index accepts legacy OCR and persists versioned trusted OCR atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-ocr-index-'))
  try {
    const primary = join(root, 'index.json')
    const backup = join(root, 'index.json.bak')
    const legacy = { ...item('legacy', 'Legacy'), ocrText: 'unversioned raw OCR' }
    const trusted = { ...item('trusted', 'Trusted'), ocrText: 'Ready', ocrVersion: 1 }
    persistLibraryIndex(primary, backup, [legacy, trusted])
    const loaded = loadLibraryIndex(primary, backup)
    assert.equal(loaded.source, 'primary')
    assert.equal(loaded.items[0].ocrVersion, undefined)
    assert.equal(loaded.items[1].ocrVersion, 1)

    await writeFile(primary, JSON.stringify([{ ...trusted, ocrVersion: -1 }]), 'utf8')
    const recovered = loadLibraryIndex(primary, backup)
    assert.equal(recovered.source, 'primary')
    assert.equal(recovered.needsRepair, true)
    assert.deepEqual(recovered.items, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('recording chunks survive reinitialization in exact byte order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-recording-'))
  const options = {
    target: 'display',
    autoZoom: false,
    zoomLevel: 2,
    fps: 30,
    microphone: false,
    systemAudio: false,
    webcam: false,
    webcamPosition: 'br',
    webcamSize: 240,
    countdown: 0
  }
  try {
    const store = new RecordingRecoveryStore(root)
    await store.initialize()
    const created = await store.create(options)
    await store.append(created.id, 0, new Uint8Array([1, 2]), 'video/webm')
    await store.append(created.id, 1, new Uint8Array([3, 4, 5]), 'video/webm')
    assert.deepEqual([...(await readFile(created.rawPath))], [1, 2, 3, 4, 5])

    const restarted = new RecordingRecoveryStore(root)
    await restarted.initialize()
    assert.equal(restarted.list()[0].byteSize, 5)
    await assert.rejects(
      restarted.append(created.id, 3, new Uint8Array([9]), 'video/webm'),
      /out of order/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
