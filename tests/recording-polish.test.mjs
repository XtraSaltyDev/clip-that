import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from './helpers.mjs'
import {
  VIDEO_EXPORT_PRESETS,
  aspectCanvasDimensions,
  aspectLabel,
  aspectRatio,
  exportPresetAvailability,
  recordingPolishCapabilities,
  recordingPolishVisible,
  transcriptStatus,
  videoExportPreset
} from '../.cache/test/src/shared/recording-polish.js'

const { loadLibraryIndex, persistLibraryIndex } = await load('src/main/store/library-index.js')
const { libraryPatch } = await load('src/main/ipc/validation.js')

const media = (overrides = {}) => ({
  ffmpeg: true,
  ffprobe: true,
  encoders: [],
  mp4: true,
  webm: true,
  gif: true,
  ...overrides
})

test('aspect presets expose stable preview ratios and labels', () => {
  assert.equal(aspectRatio('original'), null)
  assert.equal(aspectRatio('landscape'), 16 / 9)
  assert.equal(aspectRatio('square'), 1)
  assert.equal(aspectRatio('vertical'), 9 / 16)
  assert.equal(aspectLabel('vertical'), 'Vertical 9:16')
  assert.deepEqual(aspectCanvasDimensions('landscape', 1920), { width: 1920, height: 1080 })
  assert.deepEqual(aspectCanvasDimensions('square', 1280), { width: 1280, height: 1280 })
  assert.deepEqual(aspectCanvasDimensions('vertical', 1080), { width: 608, height: 1080 })
})

test('export presets map to supported local formats and gate unavailable encoders', () => {
  assert.deepEqual(videoExportPreset('presentation'), {
    id: 'presentation',
    label: 'Presentation',
    detail: 'MP4 H.264/AAC · 1920 × 1080 canvas · 30 fps',
    format: 'mp4',
    quality: 'high',
    fps: 30,
    maxWidth: 1920,
    aspect: 'landscape'
  })
  assert.equal(VIDEO_EXPORT_PRESETS.length, 3)
  assert.deepEqual(exportPresetAvailability('web', media()), { available: true, reason: '' })
  assert.equal(exportPresetAvailability('presentation', media({ mp4: false })).available, false)
  assert.match(exportPresetAvailability('presentation', media({ mp4: false })).reason, /FFmpeg/)
  assert.match(exportPresetAvailability('web', media({ ffmpeg: false })).reason, /executable/)
  assert.equal(exportPresetAvailability('web', null).available, false)
})

test('transcript lifecycle never presents partial or unavailable text as verified', () => {
  assert.equal(transcriptStatus('processing').canShowCaptions, false)
  assert.equal(transcriptStatus('ready').trust, 'trusted')
  assert.equal(transcriptStatus('ready').canEdit, true)
  assert.equal(transcriptStatus('partial').trust, 'uncertain')
  assert.equal(transcriptStatus('partial').canShowCaptions, false)
  assert.match(transcriptStatus('failed').detail, /original recording is preserved/)
  assert.equal(transcriptStatus('unavailable').trust, 'unavailable')
})

test('recording polish gates metadata-dependent features without fabricating data', () => {
  const capabilities = recordingPolishCapabilities({
    hasZoomTimeline: false,
    hasCursorMetadata: false,
    hasClickMetadata: false
  })
  assert.equal(capabilities.zooms.available, false)
  assert.match(capabilities.zooms.detail, /baked in/)
  assert.equal(capabilities.cursor.available, false)
  assert.match(capabilities.cursor.detail, /will not invent/)
  assert.equal(capabilities.clicks.available, false)
  assert.equal(recordingPolishVisible(capabilities, transcriptStatus('unavailable')), false)
  assert.equal(
    recordingPolishVisible(
      recordingPolishCapabilities({
        hasZoomTimeline: true,
        hasCursorMetadata: false,
        hasClickMetadata: false
      }),
      transcriptStatus('unavailable')
    ),
    true
  )
})

test('aspect and export choices survive validated draft persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-video-edit-'))
  try {
    const primary = join(root, 'index.json')
    const backup = join(root, 'index.json.bak')
    const draft = libraryPatch({
      videoEdit: {
        startMs: 100,
        endMs: 2_000,
        format: 'mp4',
        quality: 'high',
        aspect: 'vertical',
        exportPreset: 'vertical-social',
        updatedAt: 123
      }
    }).videoEdit
    const item = {
      id: 'video-edit',
      title: 'Recording',
      createdAt: 100,
      updatedAt: 100,
      kind: 'video',
      width: 1920,
      height: 1080,
      filePath: '/recordings/video.webm',
      thumbnail: '/recordings/video.png',
      tags: [],
      favorite: false,
      byteSize: 10,
      durationMs: 2_000,
      videoEdit: draft
    }
    persistLibraryIndex(primary, backup, [item])
    assert.deepEqual(loadLibraryIndex(primary, backup).items[0].videoEdit, draft)
    assert.throws(
      () => libraryPatch({ videoEdit: { ...draft, unsupported: true } }),
      /not supported/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
