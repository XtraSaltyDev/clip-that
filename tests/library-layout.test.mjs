import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupLibraryItems,
  libraryGridColumns
} from '../.cache/test/src/renderer/library/layout.js'

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
