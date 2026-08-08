import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { load } from './helpers.mjs'

const { RecordingRecoveryStore } = await load('recordingRecovery')

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

test('recording chunks survive store reinitialization and keep exact byte order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-recording-'))
  try {
    const store = new RecordingRecoveryStore(root)
    await store.initialize()
    const created = await store.create(options)
    await store.append(created.id, 0, new Uint8Array([1, 2]), 'video/webm;codecs=vp9')
    await store.append(created.id, 1, new Uint8Array([3, 4, 5]), 'video/webm;codecs=vp9')
    await store.update(created.id, {
      state: 'ready',
      width: 1920,
      height: 1080,
      durationMs: 2500
    })

    assert.deepEqual([...await readFile(created.rawPath)], [1, 2, 3, 4, 5])

    const afterRestart = new RecordingRecoveryStore(root)
    await afterRestart.initialize()
    const [recovery] = afterRestart.list()
    assert.equal(recovery.id, created.id)
    assert.equal(recovery.state, 'ready')
    assert.equal(recovery.byteSize, 5)
    assert.equal(recovery.chunkCount, 2)
    assert.equal(recovery.width, 1920)
    assert.equal(afterRestart.ownsRawPath(created.rawPath), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('recording store rejects out-of-order chunks and removes only an explicit recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-recording-'))
  try {
    const store = new RecordingRecoveryStore(root)
    await store.initialize()
    const first = await store.create(options)
    const second = await store.create(options)
    await assert.rejects(
      store.append(first.id, 1, new Uint8Array([9]), 'video/webm'),
      /out of order/
    )
    await store.append(second.id, 0, new Uint8Array([7]), 'video/webm')
    await store.remove(first.id)
    assert.equal(store.get(first.id), undefined)
    assert.equal(store.get(second.id)?.byteSize, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
