import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import {
  bundledFfmpegPath,
  bundledFfprobePath
} from '../.cache/test/src/main/recording/ffmpeg-path.js'

test('packaged Windows builds resolve the bundled ffmpeg executable', () => {
  assert.equal(
    bundledFfmpegPath({
      platform: 'win32',
      packaged: true,
      resourcesPath: 'C:\\ClipThat\\resources',
      appPath: 'C:\\ClipThat'
    }),
    join('C:\\ClipThat\\resources', 'third-party', 'ffmpeg', 'bin', 'ffmpeg.exe')
  )
  assert.equal(
    bundledFfprobePath({
      platform: 'win32',
      packaged: true,
      resourcesPath: 'C:\\ClipThat\\resources',
      appPath: 'C:\\ClipThat'
    }),
    join('C:\\ClipThat\\resources', 'third-party', 'ffmpeg', 'bin', 'ffprobe.exe')
  )
})

test('development builds keep platform-specific audited toolchains separate', () => {
  assert.equal(
    bundledFfmpegPath({
      platform: 'win32',
      packaged: false,
      resourcesPath: 'resources',
      appPath: 'repo'
    }),
    join('repo', 'build', 'vendor', 'ffmpeg', 'windows-x64', 'package', 'bin', 'ffmpeg.exe')
  )
  assert.equal(
    bundledFfmpegPath({
      platform: 'darwin',
      packaged: false,
      resourcesPath: 'resources',
      appPath: 'repo'
    }),
    join('repo', 'build', 'vendor', 'ffmpeg', 'package', 'bin', 'ffmpeg')
  )
})
