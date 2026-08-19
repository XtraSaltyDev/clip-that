import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { load } from './helpers.mjs'

const { RELEASE_NOTES, releaseNotesForVersion } = await load('src/shared/release-notes.js')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('package version has exactly one complete bundled release-note entry', () => {
  const matches = RELEASE_NOTES.filter((entry) => entry.version === packageJson.version)
  assert.equal(matches.length, 1, `expected one release-note entry for ${packageJson.version}`)
  const notes = releaseNotesForVersion(packageJson.version)
  assert.ok(notes?.title.trim())
  assert.ok(notes?.summary.trim())
  assert.ok(notes?.items.length)
  for (const item of notes.items) {
    assert.ok(item.title.trim())
    assert.ok(item.body.trim())
  }
})

test('supported updater artifact names derive from the package version', () => {
  assert.equal(
    `ClipThat-${packageJson.version}-arm64-mac.zip`,
    `ClipThat-${releaseNotesForVersion(packageJson.version).version}-arm64-mac.zip`
  )
})
