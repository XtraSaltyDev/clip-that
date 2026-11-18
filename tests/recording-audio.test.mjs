import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.window = { clipthat: { recording: { captureSource: async () => 'screen:1:0' } } }
const { startCapture } = await import('../.cache/test/src/renderer/hud/pipeline.js')

class Track extends EventTarget {
  constructor(kind) {
    super()
    this.kind = kind
  }
  readyState = 'live'
  enabled = true
  getSettings() {
    return { width: 1280, height: 720 }
  }
  async applyConstraints() {}
  stop() {
    this.readyState = 'ended'
  }
  unplug() {
    this.stop()
    this.dispatchEvent(new Event('ended'))
  }
}

class Stream {
  constructor(tracks) {
    this.tracks = tracks
  }
  getTracks() {
    return [...this.tracks]
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video')
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio')
  }
}

class Recorder extends EventTarget {
  static isTypeSupported = () => true
  state = 'inactive'
  start() {
    this.state = 'recording'
  }
  stop() {
    assert.notEqual(this.state, 'inactive')
    this.state = 'inactive'
    this.dispatchEvent(new Event('stop'))
  }
  writeChunk(byte) {
    this.ondataavailable({ data: new Blob([Uint8Array.of(byte)]) })
  }
}

async function record(t, { systemAudio = true, microphoneDeviceId } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const screen = new Track('video')
  const system = new Track('audio')
  const microphone = new Track('audio')
  const mix = new Track('audio')
  const inputs = new Set()
  const constraints = []
  const chunks = []
  const statuses = []
  const openMic = []
  const mediaDevices = new EventTarget()
  mediaDevices.getDisplayMedia = async () => new Stream([screen, system])
  mediaDevices.getUserMedia = async (request) => {
    if (request.video) return new Stream([screen])
    constraints.push(request.audio.deviceId)
    if (constraints.length === 1) return new Stream([microphone])
    const next = openMic.shift()
    if (!next) throw new DOMException('Device absent', 'NotFoundError')
    return new Stream([await next])
  }

  globalThis.MediaStream = Stream
  globalThis.MediaRecorder = Recorder
  globalThis.AudioContext = class {
    createMediaStreamDestination() {
      return { stream: new Stream([mix]) }
    }
    createMediaStreamSource(stream) {
      const [track] = stream.getAudioTracks()
      return { connect: () => inputs.add(track), disconnect: () => inputs.delete(track) }
    }
    async close() {
      inputs.clear()
    }
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices } })

  const capture = await startCapture(
    { fps: 30, systemAudio, microphone: true, microphoneDeviceId },
    undefined,
    async (sequence, bytes) => chunks.push([sequence, bytes[0]]),
    (disconnected) => statuses.push(disconnected)
  )
  t.after(() => capture.dispose())
  const settleReconnect = async () => {
    t.mock.timers.tick(250)
    await new Promise((resolve) => setImmediate(resolve))
  }
  const deviceChanged = () => mediaDevices.dispatchEvent(new Event('devicechange'))
  return {
    capture,
    screen,
    system,
    microphone,
    mix,
    inputs,
    chunks,
    statuses,
    constraints,
    openMic,
    settleReconnect,
    deviceChanged
  }
}

test('losing the selected mic switches to the default mic without interrupting the recording', async (t) => {
  const recording = await record(t, { microphoneDeviceId: 'airpods' })
  const { capture, screen, system, microphone, mix, inputs, chunks, statuses } = recording
  capture.recorder.writeChunk(1)
  microphone.unplug()
  await recording.settleReconnect()

  assert.deepEqual(statuses, ['disconnected'])
  assert.deepEqual([...inputs], [system])
  assert.equal(capture.recorder.state, 'recording')
  assert.deepEqual(capture.stream.getTracks(), [screen, mix])
  capture.recorder.writeChunk(2)

  const replacement = new Track('audio')
  recording.openMic.push(replacement)
  recording.deviceChanged()
  recording.deviceChanged()
  await recording.settleReconnect()

  assert.deepEqual(statuses, ['disconnected', 'system-default'])
  assert.deepEqual(recording.constraints, [{ exact: 'airpods' }, undefined, undefined])
  assert.deepEqual([...inputs], [system, replacement])
  assert.deepEqual(capture.stream.getTracks(), [screen, mix])

  // Reconnecting the original device leaves the live fallback in place.
  recording.deviceChanged()
  await recording.settleReconnect()
  assert.equal(recording.constraints.length, 3)
  assert.equal(replacement.readyState, 'live')

  screen.unplug()
  assert.equal(capture.recorder.state, 'inactive')
  await capture.stop()
  assert.deepEqual(chunks, [
    [0, 1],
    [1, 2]
  ])
  assert.equal(replacement.readyState, 'ended')
})

test('the default mic can recover during pause in a mic-only recording', async (t) => {
  const recording = await record(t, { systemAudio: false })
  const { capture, screen, microphone, mix, statuses } = recording
  capture.setPaused(true)
  microphone.unplug()
  const replacement = new Track('audio')
  recording.openMic.push(replacement)
  await recording.settleReconnect()

  assert.deepEqual(statuses, ['disconnected', 'system-default'])
  assert.deepEqual(recording.constraints, [undefined, undefined])
  assert.deepEqual(capture.stream.getTracks(), [screen, mix])
  assert.equal(capture.recorder.state, 'recording')
  assert.equal(replacement.enabled, false)
  capture.setPaused(false)
  assert.equal(replacement.enabled, true)
})

test('a mic opened after stop is released without changing the recording status', async (t) => {
  const recording = await record(t)
  const { capture, microphone, statuses } = recording
  const pending = Promise.withResolvers()
  recording.openMic.push(pending.promise)
  microphone.unplug()
  await recording.settleReconnect()
  recording.deviceChanged()
  await recording.settleReconnect()
  assert.equal(recording.constraints.length, 2)

  await capture.stop()
  const late = new Track('audio')
  pending.resolve(late)
  await recording.settleReconnect()
  recording.deviceChanged()
  await recording.settleReconnect()
  assert.equal(late.readyState, 'ended')
  assert.deepEqual(statuses, ['disconnected'])
  assert.equal(recording.constraints.length, 2)
})
