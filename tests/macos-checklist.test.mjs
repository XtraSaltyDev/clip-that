import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { displayCapturePlan } from '../.cache/test/src/shared/recording-capture.js'
import { nsFilenamesPlist } from '../.cache/test/src/shared/file-clipboard.js'
import {
  reviewPlaybackCopyArgs,
  reviewPlaybackPath
} from '../.cache/test/src/main/recording/review-playback.js'

test('system audio never shares chromeMediaSource audio with the video getUserMedia', () => {
  assert.deepEqual(displayCapturePlan(false), {
    videoOnlyGetUserMedia: true,
    loopbackGetDisplayMedia: false
  })
  assert.deepEqual(displayCapturePlan(true), {
    videoOnlyGetUserMedia: false,
    loopbackGetDisplayMedia: true
  })
})

test('review playback remux writes a sibling playable WebM next to the raw session file', () => {
  const raw = join('/tmp', 'clipthat-sessions', 'abc.webm')
  const playback = reviewPlaybackPath(raw)
  assert.equal(playback, join('/tmp', 'clipthat-sessions', 'abc.play.webm'))
  assert.deepEqual(reviewPlaybackCopyArgs(raw, playback), [
    '-hide_banner',
    '-y',
    '-fflags',
    '+genpts',
    '-i',
    raw,
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    playback
  ])
})

test('Finder pasteboard payload lists escaped absolute file paths', () => {
  const plist = nsFilenamesPlist(['/Users/test/Clip That/shot.png', '/tmp/a&b.png'])
  assert.match(plist, /<string>\/Users\/test\/Clip That\/shot.png<\/string>/)
  assert.match(plist, /<string>\/tmp\/a&amp;b.png<\/string>/)
  assert.doesNotMatch(plist, /<string>\/tmp\/a&b.png<\/string>/)
  assert.match(plist, /<plist version="1.0">/)
})
