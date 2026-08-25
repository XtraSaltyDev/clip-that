import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from './helpers.mjs'

const { loadLibraryIndex, persistLibraryIndex } = await load('src/main/store/library-index.js')
const { buildLibraryWorkbench } = await load('src/shared/library-workbench.js')
const { videoExportOptions } = await load('src/main/ipc/validation.js')

const video = (id, overrides = {}) => ({
  id,
  title: id,
  createdAt: 100,
  updatedAt: 100,
  kind: 'video',
  width: 1920,
  height: 1080,
  filePath: `/recordings/${id}.webm`,
  thumbnail: `/recordings/${id}.png`,
  tags: [],
  favorite: false,
  byteSize: 100,
  durationMs: 2_000,
  ...overrides
})

test('legacy Library videos remain valid without lineage fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-lineage-legacy-'))
  try {
    const primary = join(root, 'index.json')
    const backup = join(root, 'index.json.bak')
    const item = video('legacy')
    persistLibraryIndex(primary, backup, [item])
    const loaded = loadLibraryIndex(primary, backup)
    assert.equal(loaded.items[0].derivedFromId, undefined)
    assert.equal(loaded.needsRepair, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('valid source and derived records persist and project both directions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-lineage-valid-'))
  try {
    const primary = join(root, 'index.json')
    const backup = join(root, 'index.json.bak')
    const source = video('source', { title: 'Original recording' })
    const derived = video('derived', {
      title: 'Original recording — Edit',
      width: 608,
      height: 1080,
      derivedFromId: source.id,
      derivedAspect: 'vertical',
      derivedExportPreset: 'vertical-social'
    })
    persistLibraryIndex(primary, backup, [source, derived])
    const loaded = loadLibraryIndex(primary, backup)
    assert.equal(loaded.items[1].derivedFromId, source.id)
    assert.equal(loaded.items[1].derivedAspect, 'vertical')
    assert.equal(loaded.items[1].derivedExportPreset, 'vertical-social')

    const sourceWorkbench = buildLibraryWorkbench(source, {
      source: 'available',
      lineage: {
        derived: [
          {
            state: 'available',
            itemId: derived.id,
            title: derived.title,
            label: 'Vertical 9:16 export'
          }
        ]
      }
    })
    assert.equal(sourceWorkbench.export.state, 'available')
    assert.equal(sourceWorkbench.export.itemId, derived.id)
    assert.equal(sourceWorkbench.derived[0].label, 'Vertical 9:16 export')

    const derivedWorkbench = buildLibraryWorkbench(derived, {
      source: 'available',
      lineage: {
        source: {
          state: 'available',
          itemId: source.id,
          title: source.title,
          label: 'Source recording'
        }
      }
    })
    assert.equal(derivedWorkbench.source.itemId, source.id)
    assert.deepEqual(derivedWorkbench.project, {
      state: 'linked',
      label: 'Derived video export'
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('missing and unreadable derived files remain visible as recovery states', () => {
  const source = video('source')
  const links = [
    { state: 'available', itemId: 'good', title: 'Good export', label: 'Landscape export' },
    { state: 'missing', itemId: 'missing', title: 'Missing export', label: 'Missing export' },
    { state: 'unreadable', itemId: 'bad', title: 'Unreadable export', label: 'Unreadable export' }
  ]
  const mixed = buildLibraryWorkbench(source, { source: 'available', lineage: { derived: links } })
  assert.equal(mixed.export.state, 'incomplete')
  assert.match(mixed.export.label, /recovery/)

  const missing = buildLibraryWorkbench(source, {
    source: 'available',
    lineage: { derived: links.slice(1, 2) }
  })
  assert.equal(missing.export.state, 'missing')
})

test('unsafe, self, and cross-media relationships are rejected while missing sources remain recoverable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-lineage-invalid-'))
  try {
    const primary = join(root, 'index.json')
    const backup = join(root, 'index.json.bak')
    const image = {
      id: 'image',
      title: 'Image',
      createdAt: 100,
      updatedAt: 100,
      kind: 'image',
      width: 100,
      height: 100,
      filePath: '/captures/image.png',
      thumbnail: '/captures/image.png',
      tags: [],
      favorite: false,
      byteSize: 10
    }
    persistLibraryIndex(primary, backup, [
      video('valid'),
      video('missing-source', { derivedFromId: 'gone' }),
      video('self', { derivedFromId: 'self' }),
      video('unsafe', { derivedFromId: '../outside' }),
      video('cross-media', { derivedFromId: 'image' }),
      image
    ])
    const loaded = loadLibraryIndex(primary, backup)
    assert.deepEqual(
      loaded.items.map((item) => item.id),
      ['valid', 'missing-source', 'image']
    )
    assert.equal(loaded.needsRepair, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('video export IPC keeps aspect and preset values bounded', () => {
  const parsed = videoExportOptions({
    format: 'webm',
    quality: 'high',
    aspect: 'square',
    exportPreset: 'web'
  })
  assert.equal(parsed.aspect, 'square')
  assert.equal(parsed.exportPreset, 'web')
  assert.throws(
    () => videoExportOptions({ format: 'webm', quality: 'high', aspect: 'panorama' }),
    /video aspect is not supported/
  )
})
