import assert from 'node:assert/strict'
import test from 'node:test'
import { platformCapabilityMatrix } from '../.cache/test/src/shared/platform-capabilities.js'
import { dipRectToDisplayPixels, displayForRect } from '../.cache/test/src/main/capture/geometry.js'
import {
  captureFailureMessage,
  classifyCaptureFailure
} from '../.cache/test/src/main/capture/failures.js'
import { recordingTransitionAllowed } from '../.cache/test/src/main/recording/state.js'
import {
  classifyFfmpegError,
  ffmpegFailureKind
} from '../.cache/test/src/main/recording/ffmpeg-errors.js'
import { reconcileRecordingSources } from '../.cache/test/src/renderer/hud/recording-sources.js'

const displays = [
  {
    id: 'left',
    bounds: { x: -1920, y: -200, width: 1920, height: 1080 },
    workArea: { x: -1920, y: -200, width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
    primary: false,
    label: 'Left'
  },
  {
    id: 'primary',
    bounds: { x: 0, y: 0, width: 1707, height: 960 },
    workArea: { x: 0, y: 0, width: 1707, height: 920 },
    scaleFactor: 1.5,
    rotation: 0,
    internal: false,
    primary: true,
    label: 'Primary'
  }
]

test('Windows capability contract never claims runtime acceptance or auto-update', () => {
  const matrix = platformCapabilityMatrix('win32')
  assert.equal(matrix.length, 18)
  assert.ok(matrix.every((item) => !item.runtimeVerified))
  assert.equal(matrix.find((item) => item.id === 'update.in-app')?.state, 'unavailable')
  assert.equal(matrix.find((item) => item.id === 'record.region')?.state, 'unverified')
})

test('mixed-DPI conversion respects negative virtual-desktop origins', () => {
  assert.equal(displayForRect({ x: -1000, y: -100, width: 800, height: 600 }, displays)?.id, 'left')
  assert.deepEqual(
    dipRectToDisplayPixels({ x: 100, y: 50, width: 400, height: 300 }, displays[1]),
    { x: 150, y: 75, width: 600, height: 450 }
  )
  assert.deepEqual(
    dipRectToDisplayPixels({ x: -1820, y: -100, width: 400, height: 300 }, displays[0]),
    { x: 100, y: 100, width: 400, height: 300 }
  )
})

test('vanished and protected sources map to actionable failures', () => {
  assert.equal(classifyCaptureFailure('selected window disappeared'), 'vanished')
  assert.match(captureFailureMessage('vanished', 'The selected window'), /choose another source/i)
  assert.equal(classifyCaptureFailure('DRM protected content'), 'protected')
  assert.match(captureFailureMessage('permission', 'the screen'), /privacy settings/i)
})

test('persisted recording source never silently changes a vanished window or stale region', () => {
  const base = {
    target: 'window',
    autoZoom: false,
    zoomLevel: 1.6,
    displayId: 'missing',
    windowId: 'gone',
    region: { x: 1, y: 1, width: 100, height: 100 },
    fps: 30,
    microphone: false,
    systemAudio: false,
    webcam: false,
    webcamPosition: 'br',
    webcamSize: 220,
    countdown: 3
  }
  const reconciled = reconcileRecordingSources(base, displays, [
    { id: 'live', title: 'Live', appName: 'App' }
  ])
  assert.equal(reconciled.displayId, 'primary')
  assert.equal(reconciled.windowId, undefined)

  const region = reconcileRecordingSources({ ...base, target: 'region' }, displays, [])
  assert.equal(region.region, undefined)
})

test('recording state machine covers pause, recovery finalization, and rejects unsafe jumps', () => {
  assert.equal(recordingTransitionAllowed('idle', 'countdown'), true)
  assert.equal(recordingTransitionAllowed('countdown', 'recording'), true)
  assert.equal(recordingTransitionAllowed('recording', 'paused'), true)
  assert.equal(recordingTransitionAllowed('paused', 'recording'), true)
  assert.equal(recordingTransitionAllowed('recording', 'encoding'), true)
  assert.equal(recordingTransitionAllowed('encoding', 'idle'), true)
  assert.equal(recordingTransitionAllowed('idle', 'recording'), false)
  assert.equal(recordingTransitionAllowed('encoding', 'paused'), false)
})

test('FFmpeg failures remain specific and promise raw-data preservation', () => {
  assert.equal(ffmpegFailureKind('No space left on device'), 'space')
  assert.equal(ffmpegFailureKind('Unknown encoder h264_mf'), 'encoder')
  assert.equal(ffmpegFailureKind('Invalid data found when processing input'), 'input')
  for (const message of [
    classifyFfmpegError('No space left on device'),
    classifyFfmpegError('Unknown encoder h264_mf'),
    classifyFfmpegError('Invalid data found when processing input')
  ])
    assert.match(message, /raw recording was preserved/i)
})
