import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { RELEASE_NOTES, releaseNotesForVersion, releaseNotesStatus } = await load('releaseNotes')

const catalog = [
  {
    version: '0.1.5',
    title: 'Earlier release',
    summary: 'Earlier summary',
    items: [{ title: 'Earlier item', body: 'Earlier body' }]
  },
  {
    version: '0.1.6',
    title: 'Current release',
    summary: 'Current summary',
    items: [{ title: 'Current item', body: 'Current body' }]
  }
]

test('selects bundled notes for the exact app version', () => {
  assert.equal(releaseNotesForVersion('0.1.6', catalog).title, 'Current release')
  assert.equal(releaseNotesForVersion('0.1.5', catalog).title, 'Earlier release')
  assert.equal(releaseNotesForVersion('0.1.7', catalog), null)
})

test('shows the current release as unread until that version is marked seen', () => {
  const firstOpen = releaseNotesStatus('0.1.6', null, catalog)
  assert.equal(firstOpen.unread, true)
  assert.equal(firstOpen.lastSeenVersion, null)

  const afterOpen = releaseNotesStatus('0.1.6', '0.1.6', catalog)
  assert.equal(afterOpen.unread, false)
  assert.equal(afterOpen.notes.version, '0.1.6')

  const nextRelease = releaseNotesStatus('0.1.7', '0.1.6', catalog)
  assert.equal(nextRelease.notes, null)
  assert.equal(nextRelease.unread, false)
})

test('does not show an earlier release as the current release', () => {
  const status = releaseNotesStatus('0.1.6', '0.1.5', catalog)
  assert.equal(status.notes.title, 'Current release')
  assert.equal(status.unread, true)
})

test('bundles the 0.1.8 editor and import release notes', () => {
  const notes = RELEASE_NOTES.find((entry) => entry.version === '0.1.8')
  assert.ok(notes)
  assert.match(notes.summary, /Snagit|Library/i)
  assert.ok(notes.items.some((item) => /Cut Out/i.test(item.title)))
  assert.ok(notes.items.some((item) => /Snagit/i.test(item.title)))
  assert.ok(notes.items.some((item) => /Step/i.test(item.title)))
})

test('bundles the 0.1.9 rotation and reliability release notes', () => {
  const notes = RELEASE_NOTES.find((entry) => entry.version === '0.1.9')
  assert.ok(notes)
  assert.match(notes.title, /Rotation/i)
  assert.ok(notes.items.some((item) => /Rotate/i.test(item.title)))
  assert.ok(notes.items.some((item) => /resilient|reliability/i.test(item.title + item.body)))
})
