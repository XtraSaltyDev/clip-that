import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { load } from './helpers.mjs'

const { RELEASE_NOTES, releaseNotesForVersion } = await load('src/shared/release-notes.js')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const windowsBuilder = await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8')
const windowsWorkflow = await readFile(
  new URL('../.github/workflows/windows-candidate.yml', import.meta.url),
  'utf8'
)
const windowsReleaseScript = await readFile(
  new URL('../scripts/release-win.ps1', import.meta.url),
  'utf8'
)
const updateService = await readFile(
  new URL('../src/main/update/service.ts', import.meta.url),
  'utf8'
)

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

test('Windows release contract stays unsigned, explicitly named, manual, and exact-version gated', () => {
  assert.match(windowsBuilder, /unsigned-experimental-preview/)
  assert.match(windowsWorkflow, /Validate requested preview version/)
  assert.match(windowsWorkflow, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/)
  assert.match(windowsWorkflow, /unexpectedly produced a signed executable/)
  assert.match(windowsWorkflow, /unsigned experimental Windows preview/i)
  assert.doesNotMatch(windowsWorkflow, /^\s+push:/m)
  assert.match(windowsReleaseScript, /--publish never/)
  assert.match(windowsReleaseScript, /No release was published/)
  assert.match(updateService, /process\.platform === 'darwin'/)
})
