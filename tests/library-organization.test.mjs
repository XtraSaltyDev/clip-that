import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { load } from './helpers.mjs'

const { parseLibrarySearch, matchesLibraryItemSearch } = await load('src/shared/library-search.js')
const { applyLibraryBatch } = await load('src/shared/library-batch.js')
const { libraryBatchPatch, libraryCollectionInput } = await load('src/main/ipc/validation.js')
const { LibraryCollections } = await load('src/main/store/library-collections.js')
const { searchableOcrText } = await load('src/main/store/library-ocr.js')

const capture = {
  id: 'capture',
  title: 'Invoice review',
  tags: ['client work', 'finance'],
  favorite: true,
  kind: 'image',
  createdAt: new Date(2026, 10, 17, 0, 15).getTime(),
  updatedAt: 123,
  filePath: '/captures/original.png',
  thumbnail: '/thumbnails/original.png',
  projectPath: '/projects/original.clipthat',
  exportPath: '/exports/invoice.webp',
  ocrText: 'Marcus Bell paid',
  ocrVersion: 1,
  width: 100,
  height: 80,
  byteSize: 10
}
const match = (query, item = capture, text = 'Marcus Bell paid') =>
  matchesLibraryItemSearch(item, text, parseLibrarySearch(query))

test('field search combines phrases, exact tags, OCR, type, favourite and exclusions', () => {
  assert.equal(
    match('title:invoice tag:"CLIENT WORK" text:"marcus bell" type:image is:favorite -draft'),
    true
  )
  for (const query of [
    'title:marcus',
    'tag:client',
    'text:invoice',
    'type:video',
    '-is:favorite',
    '-tag:finance'
  ])
    assert.equal(match(query), false, query)
  assert.equal(match('is:favourite'), true)
  assert.equal(match('-text:secret -type:video -tag:other'), true)
  assert.equal(match('invoice "marcus bell" -draft'), true)
  assert.equal(match('tag:"client work"', { ...capture, tags: ['client works'] }), false)
  assert.equal(match('is:favorite', { ...capture, favorite: false }), false)
})

test('date search uses local capture dates and handles inclusive start and exclusive end', () => {
  assert.equal(match('after:2026-11-17 before:2026-11-18'), true)
  assert.equal(match('before:2026-11-17'), false)
  assert.equal(match('after:2026-11-18'), false)
  assert.equal(match('-after:2026-11-18 -before:2026-11-17'), true)
  const midnight = { ...capture, createdAt: new Date(2026, 10, 18).getTime() }
  assert.equal(match('before:2026-11-18', midnight), false)
  assert.equal(match('after:2026-11-18', midnight), true)
  assert.equal(
    match('after:2024-02-29', { ...capture, createdAt: new Date(2024, 1, 29, 12).getTime() }),
    true
  )
})

test('invalid field values, URLs and wholly quoted operators remain literal search terms', () => {
  for (const value of [
    'before:2026-02-30',
    'after:2026-13-01',
    'type:pdf',
    'is:unknown',
    'https://example.com',
    'unknown:value'
  ]) {
    assert.deepEqual(parseLibrarySearch(value), [{ text: value, exclude: false }])
    assert.equal(match(value, { ...capture, title: value }), true)
  }
  assert.deepEqual(parseLibrarySearch('"tag:client work"'), [
    { text: 'tag:client work', exclude: false }
  ])
  assert.deepEqual(parseLibrarySearch('tag:""'), [])
})

test('text field never promotes legacy or rejected OCR to searchable data', () => {
  const legacy = { ...capture, ocrVersion: undefined }
  assert.equal(match('text:marcus', legacy, searchableOcrText(legacy)), false)
  assert.equal(match('text:marcus', capture, searchableOcrText(capture)), true)
  assert.equal(match('title:invoice', legacy, searchableOcrText(legacy)), true)
})

test('batch tagging preserves unrelated metadata, source links and existing tags', () => {
  const other = { ...capture, id: 'other', tags: ['other'], kind: 'video', favorite: false }
  const original = structuredClone([capture, other])
  const next = applyLibraryBatch(
    original,
    ['capture', 'other', 'other'],
    { tag: { action: 'add', value: 'reviewed' }, favorite: true },
    999
  )
  assert.deepEqual(next[0], { ...capture, tags: [...capture.tags, 'reviewed'], updatedAt: 999 })
  assert.deepEqual(next[1], {
    ...other,
    tags: ['other', 'reviewed'],
    favorite: true,
    updatedAt: 999
  })
  assert.deepEqual(original, [capture, other])
  assert.equal(
    applyLibraryBatch(next, ['capture'], { tag: { action: 'add', value: 'reviewed' } }, 1000)[0],
    next[0]
  )
  const removed = applyLibraryBatch(
    next,
    ['capture'],
    { tag: { action: 'remove', value: 'reviewed' } },
    1001
  )
  assert.deepEqual(removed[0].tags, capture.tags)
  assert.equal(removed[1], next[1])
})

test('batch preflight rejects stale/trashed selections and tag overflow without mutating inputs', () => {
  const full = {
    ...capture,
    id: 'full',
    tags: Array.from({ length: 50 }, (_, index) => `tag${index}`)
  }
  const original = [capture, full, { ...capture, id: 'trashed', deletedAt: 123 }]
  const snapshot = structuredClone(original)
  assert.throws(
    () =>
      applyLibraryBatch(original, ['capture', 'full'], { tag: { action: 'add', value: 'new' } }),
    /50 tags/
  )
  for (const ids of [[], ['missing'], ['capture', 'trashed']])
    assert.throws(
      () => applyLibraryBatch(original, ids, { favorite: false }),
      /no longer available/
    )
  assert.deepEqual(original, snapshot)
  assert.deepEqual(
    applyLibraryBatch(original, ['full'], { tag: { action: 'remove', value: 'tag0' } })[1].tags,
    full.tags.slice(1)
  )
})

test('batch and collection IPC validation reject path, identity and query escalation', () => {
  assert.deepEqual(libraryBatchPatch({ tag: { action: 'add', value: ' client ' } }), {
    tag: { action: 'add', value: 'client' }
  })
  for (const patch of [
    {},
    { favorite: 'yes' },
    { title: 'changed' },
    { exportPath: '/tmp/file' },
    { tag: { action: 'replace', value: 'x' } },
    { tag: { action: 'add', value: ' ' } },
    { tag: { action: 'add', value: 'x'.repeat(121) } },
    { tag: { action: 'add', value: 'x', filePath: '/tmp/a' } }
  ])
    assert.throws(() => libraryBatchPatch(patch))
  for (const query of [
    { filter: 'all', trashed: true },
    { filter: 'all', limit: 1000 },
    { filter: 'all', offset: 120 },
    { filter: 'unknown' },
    { filter: 'all', search: 'x'.repeat(1001) }
  ])
    assert.throws(() => libraryCollectionInput({ name: 'Test', query }))
  assert.throws(() => libraryCollectionInput({ id: '', name: 'Test', query: { filter: 'all' } }))
  assert.throws(() => libraryCollectionInput({ name: ' ', query: { filter: 'all' } }))
  assert.throws(() =>
    libraryCollectionInput({ name: 'Test', query: { filter: 'all' }, filePath: '/tmp/file' })
  )
})

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'clipthat-collections-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const path = join(root, 'collections.json')
  return { path, store: new LibraryCollections(() => path) }
}
const draft = (name) => ({
  name,
  query: { filter: 'image', search: 'tag:"client work" -draft', tag: 'finance', sort: 'oldest' }
})

test('collections survive restart, rename and removal with their criteria intact', async (t) => {
  const f = await fixture(t)
  assert.deepEqual(await f.store.list(), [])
  const [saved] = await f.store.save(draft('Client work'))
  assert.ok(saved.id)
  const restarted = new LibraryCollections(() => f.path)
  assert.deepEqual(await restarted.list(), [saved])
  const [renamed] = await restarted.save({ ...saved, name: 'Renamed' })
  assert.deepEqual(renamed.query, saved.query)
  assert.equal(renamed.id, saved.id)
  assert.deepEqual(await restarted.remove(saved.id), [])
  assert.deepEqual(await new LibraryCollections(() => f.path).list(), [])
  await assert.rejects(restarted.save({ ...saved, name: 'Stale' }), /was removed/)
})

test('concurrent collection requests serialize without losing saves or duplicating names', async (t) => {
  const f = await fixture(t)
  await Promise.all(
    Array.from({ length: 12 }, (_, index) => f.store.save(draft(`Client ${index}`)))
  )
  const all = await f.store.list()
  assert.equal(all.length, 12)
  assert.equal(new Set(all.map((entry) => entry.id)).size, 12)
  const attempts = await Promise.allSettled([
    f.store.save(draft('Duplicate')),
    f.store.save(draft('duplicate'))
  ])
  assert.deepEqual(
    attempts.map((result) => result.status),
    ['fulfilled', 'rejected']
  )
  assert.equal((await f.store.list()).length, 13)
})

test('collections recover a corrupt or missing primary from the last valid generation', async (t) => {
  const f = await fixture(t)
  const first = await f.store.save(draft('First'))
  await f.store.save(draft('Second'))
  await fs.writeFile(f.path, '{corrupt')
  let recoveries = 0
  const recovered = new LibraryCollections(
    () => f.path,
    () => recoveries++
  )
  assert.deepEqual(await recovered.list(), first)
  assert.equal(recoveries, 1)
  assert.deepEqual(JSON.parse(await fs.readFile(f.path, 'utf8')), JSON.parse(JSON.stringify(first)))
  await fs.rm(f.path)
  assert.deepEqual(await f.store.list(), first)
})

test('unrecoverable collections report corruption and preserve both damaged files', async (t) => {
  const f = await fixture(t)
  await fs.writeFile(f.path, '{bad primary')
  await fs.writeFile(`${f.path}.bak`, '{bad backup')
  await assert.rejects(f.store.list())
  await assert.rejects(f.store.save(draft('Replacement')))
  assert.equal(await fs.readFile(f.path, 'utf8'), '{bad primary')
  assert.equal(await fs.readFile(`${f.path}.bak`, 'utf8'), '{bad backup')
  await fs.rm(f.path)
  await assert.rejects(f.store.list(), /need recovery/)
  assert.equal(await fs.readFile(`${f.path}.bak`, 'utf8'), '{bad backup')
})

test('failed collection replacement keeps the committed generation and permits retry', async (t) => {
  const f = await fixture(t)
  const first = await f.store.save(draft('First'))
  const rename = fs.rename.bind(fs)
  const stub = t.mock.method(fs, 'rename', async (source, target) => {
    if (target === f.path) throw new Error('simulated disk failure')
    return rename(source, target)
  })
  await assert.rejects(f.store.save(draft('Second')), /simulated disk failure/)
  assert.deepEqual(await f.store.list(), first)
  stub.mock.restore()
  assert.equal((await f.store.save(draft('Second'))).length, 2)
  assert.equal(
    (await fs.readdir(join(f.path, '..'))).some((name) => name.endsWith('.tmp')),
    false
  )
})

test('collection capacity and identity checks preserve the last committed set', async (t) => {
  const f = await fixture(t)
  const entries = Array.from({ length: 100 }, (_, index) => ({
    ...draft(`Collection ${index}`),
    id: `collection-${index}`
  }))
  await fs.writeFile(f.path, JSON.stringify(entries))
  await assert.rejects(f.store.save(draft('Overflow')), /up to 100/)
  assert.equal((await f.store.list()).length, 100)
  assert.equal(
    (await f.store.save({ ...entries[0], name: 'Renamed at capacity' }))[0].name,
    'Renamed at capacity'
  )
  await fs.writeFile(f.path, JSON.stringify([entries[0], entries[0]]))
  await fs.writeFile(`${f.path}.bak`, 'invalid')
  await assert.rejects(f.store.list(), /identity/)
})

test('preload forwards organization actions through their narrow IPC channels', async () => {
  const ts = (await import('typescript')).default
  const { IPC } = await load('src/shared/ipc.js')
  const source = await fs.readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  let bridge
  const calls = []
  const require = (name) => {
    if (name === '@shared/ipc') return { IPC }
    assert.equal(name, 'electron')
    return {
      contextBridge: {
        exposeInMainWorld: (_name, value) => {
          bridge = value
        }
      },
      ipcRenderer: {
        invoke: async (...args) => {
          calls.push(args)
          return 'result'
        }
      }
    }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports)
  const patch = { tag: { action: 'add', value: 'client work' } }
  const input = draft('Client')
  assert.equal(await bridge.library.updateBatch(['capture'], patch), 'result')
  await bridge.library.collections()
  await bridge.library.saveCollection(input)
  await bridge.library.removeCollection('collection-1')
  assert.deepEqual(calls, [
    [IPC.libraryBatchUpdate, ['capture'], patch],
    [IPC.libraryCollectionsList],
    [IPC.libraryCollectionsSave, input],
    [IPC.libraryCollectionsRemove, 'collection-1']
  ])
  const handlers = await fs.readFile(
    new URL('../src/main/ipc/handlers.ts', import.meta.url),
    'utf8'
  )
  for (const channel of [
    'libraryBatchUpdate',
    'libraryCollectionsList',
    'libraryCollectionsSave',
    'libraryCollectionsRemove'
  ])
    assert.match(handlers, new RegExp(`secureHandle\\(IPC\\.${channel}, \\['library'\\]`))
})
