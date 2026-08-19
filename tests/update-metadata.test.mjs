import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from './helpers.mjs'

const { validateMacUpdateMetadata } = await load('src/main/update/metadata.js')
const SHA512 = `${'a'.repeat(86)}==`

function metadata(version = '0.1.14') {
  return {
    version,
    files: [{ url: `ClipThat-${version}-arm64-mac.zip`, sha512: SHA512, size: 139_000_000 }],
    releaseDate: '2026-08-19T14:09:00.000Z'
  }
}

test('accepts one exact macOS updater ZIP with strict metadata', () => {
  assert.deepEqual(validateMacUpdateMetadata(metadata()), {
    version: '0.1.14',
    publishedAt: '2026-08-19T14:09:00.000Z',
    size: 139_000_000
  })
})

test('rejects alternate files, unsafe paths and malformed updater fields', () => {
  const cases = [
    (value) => {
      value.version = '01.1.14'
    },
    (value) => {
      value.files.push({ ...value.files[0], url: 'other.zip' })
    },
    (value) => {
      value.files[0].url = '../ClipThat-0.1.14-arm64-mac.zip'
    },
    (value) => {
      value.files[0].url = 'ClipThat-0.1.14-arm64.dmg'
    },
    (value) => {
      value.files[0].sha512 = 'not-a-digest'
    },
    (value) => {
      value.files[0].size = 0
    },
    (value) => {
      value.releaseDate = '2026-08-19'
    }
  ]
  for (const mutate of cases) {
    const value = metadata()
    mutate(value)
    assert.throws(() => validateMacUpdateMetadata(value))
  }
})
