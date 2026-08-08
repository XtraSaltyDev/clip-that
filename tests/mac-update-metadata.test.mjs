import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { gzipSync } from 'node:zlib'
import {
  createMacUpdateMetadata,
  verifyMacUpdateFiles
} from '../scripts/prepare-mac-update.mjs'

const directory = mkdtempSync(join(tmpdir(), 'clipthat-mac-update-'))
const archive = join(directory, 'ClipThat-0.1.5-arm64-mac.zip')
const blockmap = `${archive}.blockmap`
const metadata = join(directory, 'latest-mac.yml')
writeFileSync(archive, 'signed-update-zip')
writeFileSync(
  blockmap,
  gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', checksums: ['abc'] }] }))
)

after(() => rmSync(directory, { recursive: true }))

test('generates updater metadata from the exact ZIP bytes', () => {
  const value = createMacUpdateMetadata({
    archivePath: archive,
    publishedAt: '2026-08-08T15:00:00.000Z',
    version: '0.1.5'
  })
  assert.match(value, /^version: 0\.1\.5$/m)
  assert.match(value, /url: releases\/0\.1\.5\/ClipThat-0\.1\.5-arm64-mac\.zip/)
  assert.match(value, /sha512: [A-Za-z0-9+/]{86}==/)
  writeFileSync(metadata, value)
  verifyMacUpdateFiles({ archivePath: archive, blockmapPath: blockmap, metadataPath: metadata, version: '0.1.5' })
})

test('rejects metadata drift and unusable blockmaps', () => {
  writeFileSync(
    metadata,
    createMacUpdateMetadata({
      archivePath: archive,
      publishedAt: '2026-08-08T15:00:00.000Z',
      version: '0.1.5'
    })
  )
  writeFileSync(archive, 'changed-update-zip')
  assert.throws(() =>
    verifyMacUpdateFiles({ archivePath: archive, blockmapPath: blockmap, metadataPath: metadata, version: '0.1.5' })
  )
})
