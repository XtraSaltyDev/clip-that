import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupLibraryItems,
  libraryEmptyState,
  libraryGridColumns
} from '../.cache/test/src/renderer/library/layout.js'
import { buildLibraryWorkbench } from '../.cache/test/src/shared/library-workbench.js'

test('grid columns track useful card widths from compact through expanded layouts', () => {
  assert.equal(libraryGridColumns(300), 1)
  assert.equal(libraryGridColumns(520), 2)
  assert.equal(libraryGridColumns(760), 3)
  assert.equal(libraryGridColumns(1040), 4)
})

test('large date-grouped datasets keep API ordering and stable group membership', () => {
  const now = new Date(2026, 7, 19, 12).getTime()
  const day = 86_400_000
  const items = Array.from({ length: 100 }, (_, index) => ({
    id: `capture-${index}`,
    createdAt: now - Math.floor(index / 20) * day
  }))
  const groups = groupLibraryItems(items, now)

  assert.equal(groups.length, 5)
  assert.deepEqual(
    groups.map((group) => group.items.length),
    [20, 20, 20, 20, 20]
  )
  assert.deepEqual(
    groups.flatMap((group) => group.items.map((item) => item.id)),
    items.map((item) => item.id)
  )
})

test('Library workbench keeps source, project, export and recovery states explicit', () => {
  const image = {
    kind: 'image',
    projectPath: '/captures/example.clipthat',
    exportPath: '/exports/example.png',
    recovered: true
  }
  const healthy = buildLibraryWorkbench(image, {
    source: 'available',
    project: 'available',
    export: 'available'
  })
  assert.deepEqual(healthy.source, { state: 'available', label: 'Recovered capture' })
  assert.deepEqual(healthy.project, { state: 'linked', label: 'Editable project' })
  assert.deepEqual(healthy.export, { state: 'available', label: 'Export linked' })

  const degraded = buildLibraryWorkbench(image, {
    source: 'missing',
    project: 'unreadable',
    export: 'missing'
  })
  assert.deepEqual(degraded.source, { state: 'missing', label: 'Capture missing or moved' })
  assert.deepEqual(degraded.project, { state: 'unreadable', label: 'Project unreadable' })
  assert.deepEqual(degraded.export, { state: 'missing', label: 'Export missing or moved' })

  const recording = buildLibraryWorkbench(
    { kind: 'video', videoEdit: { startMs: 0, endMs: 1000 } },
    { source: 'incomplete' }
  )
  assert.deepEqual(recording.source, {
    state: 'incomplete',
    label: 'Capture incomplete; original preserved'
  })
  assert.deepEqual(recording.project, { state: 'linked', label: 'Video edit draft' })
  assert.deepEqual(recording.export, { state: 'none', label: 'No export linked' })
})

test('Library empty state distinguishes an empty collection from a no-match query', () => {
  assert.equal(libraryEmptyState('', 'all', '').title, 'Your Library is empty')
  assert.equal(libraryEmptyState('invoice', 'all', '').title, 'Nothing matched these filters')
  assert.equal(libraryEmptyState('', 'favorite', '').title, 'Nothing matched these filters')
  assert.equal(libraryEmptyState('', 'all', 'finance').title, 'Nothing matched these filters')
})
