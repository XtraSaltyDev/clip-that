import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { load } from './helpers.mjs'

const { LibraryTrash, isTrashed } = await load('src/main/store/library-trash.js')
const { loadLibraryIndex, persistLibraryIndex } = await load('src/main/store/library-index.js')
const { libraryQuery, libraryPatch } = await load('src/main/ipc/validation.js')

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'clipthat-trash-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const roots = Object.fromEntries(
    ['captures', 'recordings', 'projects', 'thumbs'].map((key) => [key, join(root, key)])
  )
  await Promise.all(Object.values(roots).map((path) => fs.mkdir(path)))
  const item = {
    id: 'capture',
    title: 'Invoice',
    createdAt: 100,
    updatedAt: 200,
    kind: 'image',
    width: 100,
    height: 80,
    filePath: join(roots.captures, 'capture.png'),
    thumbnail: join(roots.thumbs, 'capture.png'),
    projectPath: join(roots.projects, 'capture.clipthat'),
    exportPath: join(root, 'external.png'),
    tags: ['invoice'],
    favorite: true,
    byteSize: 8,
    ocrText: 'Marcus Bell',
    ocrVersion: 1
  }
  await Promise.all(
    [item.filePath, item.thumbnail, item.projectPath, item.exportPath].map((path) =>
      fs.writeFile(path, 'original')
    )
  )
  const primary = join(root, 'index.json'),
    backup = join(root, 'index.json.bak')
  let items = [item]
  persistLibraryIndex(primary, backup, items)
  const read = () => items
  const commit = (next) => {
    persistLibraryIndex(primary, backup, next)
    items = next
  }
  return {
    root,
    roots,
    item,
    primary,
    backup,
    read,
    commit,
    trash: new LibraryTrash(read, commit, roots)
  }
}

test('Trash survives a restart and restores all original metadata and bytes', async (t) => {
  const f = await fixture(t)
  f.trash.move(['capture', 'capture', 'unknown'])
  const deletedAt = f.read()[0].deletedAt
  assert.ok(deletedAt > 0)
  f.trash.move(['capture'])
  assert.equal(f.read()[0].deletedAt, deletedAt)
  const restarted = loadLibraryIndex(f.primary, f.backup)
  assert.equal(restarted.needsRepair, false)
  assert.equal(isTrashed(restarted.items[0]), true)
  f.commit(restarted.items)
  new LibraryTrash(f.read, f.commit, f.roots).restore(['capture'])
  assert.deepEqual(f.read(), [f.item])
  for (const path of [f.item.filePath, f.item.projectPath, f.item.thumbnail, f.item.exportPath])
    assert.equal(await fs.readFile(path, 'utf8'), 'original')
})

test('failed index writes leave Trash and restore transactions unchanged', async (t) => {
  const f = await fixture(t)
  const broken = new LibraryTrash(
    f.read,
    () => {
      throw new Error('disk full')
    },
    f.roots
  )
  assert.throws(() => broken.move(['capture']), /disk full/)
  assert.deepEqual(f.read(), [f.item])
  f.trash.move(['capture'])
  const snapshot = structuredClone(f.read())
  assert.throws(() => broken.restore(['capture']), /disk full/)
  assert.deepEqual(f.read(), snapshot)
  assert.equal(await fs.readFile(f.item.filePath, 'utf8'), 'original')
})

test('permanent deletion rejects active items and preserves external exports', async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.trash.purge(['capture']), /Only items in Trash/)
  assert.equal(await fs.readFile(f.item.filePath, 'utf8'), 'original')
  f.trash.move(['capture'])
  await f.trash.purge(['capture'])
  assert.deepEqual(f.read(), [])
  for (const path of [f.item.filePath, f.item.projectPath, f.item.thumbnail])
    await assert.rejects(fs.stat(path), { code: 'ENOENT' })
  assert.equal(await fs.readFile(f.item.exportPath, 'utf8'), 'original')
})

test('permanent deletion preflights the whole batch and rejects paths and symlinks outside Library ownership', async (t) => {
  const f = await fixture(t)
  f.trash.move(['capture'])
  f.commit([
    ...f.read(),
    { ...f.item, id: 'unsafe', deletedAt: Date.now(), filePath: f.item.exportPath }
  ])
  await assert.rejects(f.trash.purge(['capture', 'unsafe']), /outside its Library folder/)
  assert.equal(await fs.readFile(f.item.filePath, 'utf8'), 'original')
  f.commit(f.read().filter((item) => item.id === 'capture'))
  await fs.rm(f.item.projectPath)
  await fs.symlink(f.item.exportPath, f.item.projectPath)
  await assert.rejects(f.trash.purge(['capture']), /not a regular Library file/)
  assert.equal(await fs.readFile(f.item.filePath, 'utf8'), 'original')
  assert.equal(await fs.readFile(f.item.exportPath, 'utf8'), 'original')
})

test('partial deletion keeps tombstones and retries missing files safely', async (t) => {
  const f = await fixture(t)
  f.trash.move(['capture'])
  const rm = fs.rm.bind(fs)
  const stub = t.mock.method(fs, 'rm', async (path, ...args) => {
    if (path === f.item.projectPath) throw new Error('file busy')
    return rm(path, ...args)
  })
  await assert.rejects(f.trash.purge(['capture']), /Items remain in Trash; retry/)
  assert.equal(isTrashed(loadLibraryIndex(f.primary, f.backup).items[0]), true)
  stub.mock.restore()
  await f.trash.purge(['capture'])
  assert.deepEqual(f.read(), [])
})

test('restore is blocked during purge and newly arriving captures survive the commit', async (t) => {
  const f = await fixture(t)
  f.trash.move(['capture'])
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const lstat = fs.lstat.bind(fs)
  const stub = t.mock.method(fs, 'lstat', async (...args) => {
    await gate
    return lstat(...args)
  })
  const purging = f.trash.purge(['capture'])
  assert.throws(() => f.trash.restore(['capture']), /Wait for deletion/)
  assert.throws(() => f.trash.move(['capture']), /Wait for deletion/)
  f.commit([
    ...f.read(),
    {
      ...f.item,
      id: 'new',
      filePath: join(f.roots.captures, 'new.png'),
      thumbnail: '',
      projectPath: undefined,
      exportPath: undefined
    }
  ])
  release()
  await purging
  stub.mock.restore()
  assert.deepEqual(
    f.read().map((item) => item.id),
    ['new']
  )
})

test('files still referenced by retained records are not permanently deleted', async (t) => {
  const f = await fixture(t)
  f.trash.move(['capture'])
  f.commit([...f.read(), { ...f.item, id: 'shared' }])
  await f.trash.purge(['capture'])
  assert.deepEqual(
    f.read().map((item) => item.id),
    ['shared']
  )
  assert.equal(await fs.readFile(f.item.filePath, 'utf8'), 'original')
  assert.equal(await fs.readFile(f.item.projectPath, 'utf8'), 'original')
})

test('index and IPC validate the Trash marker without allowing renderer patches', async (t) => {
  const f = await fixture(t)
  assert.equal(libraryQuery({ trashed: true }).trashed, true)
  assert.throws(() => libraryQuery({ trashed: 'true' }), /true or false/)
  assert.throws(() => libraryPatch({ deletedAt: 100 }), /deletedAt cannot be changed/)
  for (const deletedAt of [0, -1, 'today', null]) {
    await fs.writeFile(f.primary, JSON.stringify([{ ...f.item, deletedAt }]))
    assert.equal(loadLibraryIndex(f.primary, f.backup).items.length, 0)
  }
})

// Exercise the production LibraryStore without launching Electron or touching userData.
// Only Electron's image primitive and application paths are replaced; storage and queries are real.
async function productionStore(f) {
  const source = await fs.readFile(new URL('../src/main/store/library.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const require = createRequire(
    new URL('../.cache/test/src/main/store/library.js', import.meta.url)
  )
  const image = {
    getSize: () => ({ width: 100, height: 80 }),
    toPNG: () => Buffer.from('edited'),
    isEmpty: () => false
  }
  const customRequire = (name) => {
    if (name === 'electron')
      return { nativeImage: { createFromDataURL: () => image, createFromPath: () => image } }
    if (name === './paths')
      return {
        capturesDir: () => f.roots.captures,
        recordingsDir: () => f.roots.recordings,
        projectsDir: () => f.roots.projects,
        thumbsDir: () => f.roots.thumbs,
        libraryIndexFile: () => f.primary,
        libraryIndexBackupFile: () => f.backup
      }
    return require(name.startsWith('@shared/') ? `../../shared/${name.slice(8)}` : name)
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(customRequire, module, module.exports)
  return module.exports.library
}

test('production Library hides Trash from search, tags, editors and OCR, then restores it', async (t) => {
  const f = await fixture(t)
  const store = await productionStore(f)
  await store.initialize()
  await store.remove(['capture'])
  assert.equal((await store.list({ search: 'Marcus' })).length, 0)
  assert.equal(store.get('capture'), undefined)
  assert.deepEqual(store.allTags(), [])
  assert.deepEqual(store.ocrUpgradeBatch(10), [])
  assert.equal(await store.loadProject('capture'), null)
  assert.equal(store.update('capture', { title: 'Changed' }), undefined)
  await assert.rejects(store.replaceImage('capture', 'data:image/png;base64,AA=='), /in Trash/)
  assert.equal((await store.list({ trashed: true, search: 'invoice' }))[0].id, 'capture')
  const restarted = await productionStore(f)
  await restarted.initialize()
  assert.equal((await restarted.list()).length, 0)
  restarted.restore(['capture'])
  assert.equal((await restarted.list({ search: 'Marcus' }))[0].favorite, true)
  assert.deepEqual(restarted.allTags(), ['invoice'])
})

test('startup keeps interrupted purges in Trash even when their originals are missing', async (t) => {
  const f = await fixture(t)
  f.trash.move(['capture'])
  await fs.rm(f.item.filePath)
  const store = await productionStore(f)
  await store.initialize()
  assert.equal((await store.list()).length, 0)
  const trash = await store.list({ trashed: true })
  assert.equal(trash[0].workbench.source.state, 'missing')
  await store.purge(['capture'])
  assert.equal((await store.list({ trashed: true })).length, 0)
})

test('an in-flight image save cannot resurrect a trashed capture or race permanent deletion', async (t) => {
  const f = await fixture(t)
  const store = await productionStore(f)
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const stat = fs.stat.bind(fs)
  const stub = t.mock.method(fs, 'stat', async (...args) => {
    await gate
    return stat(...args)
  })
  const saving = store.replaceImage('capture', 'data:image/png;base64,AA==')
  await store.remove(['capture'])
  await assert.rejects(store.purge(['capture']), /still being saved/)
  release()
  await assert.rejects(saving, /moved to Trash while saving/)
  stub.mock.restore()
  assert.equal(store.get('capture'), undefined)
  const trashed = (await store.list({ trashed: true }))[0]
  assert.ok(trashed.deletedAt)
  assert.equal(trashed.ocrVersion, undefined)
})

test('a failed final index commit leaves an interrupted purge retryable after restart', async (t) => {
  const f = await fixture(t)
  f.trash.move(['capture'])
  const broken = new LibraryTrash(
    f.read,
    () => {
      throw new Error('index disk full')
    },
    f.roots
  )
  await assert.rejects(broken.purge(['capture']), /index disk full/)
  const restarted = await productionStore(f)
  await restarted.initialize()
  assert.equal((await restarted.list()).length, 0)
  assert.equal((await restarted.list({ trashed: true })).length, 1)
  await restarted.purge(['capture'])
  assert.equal((await restarted.list({ trashed: true })).length, 0)
})

test('recording drafts and source relationships survive a Trash and restore round trip', async (t) => {
  const f = await fixture(t)
  const original = {
    ...f.item,
    id: 'recording',
    kind: 'video',
    filePath: join(f.roots.recordings, 'recording.webm'),
    durationMs: 2000,
    videoEdit: {
      startMs: 100,
      endMs: 1800,
      format: 'webm',
      quality: 'high',
      aspect: 'square',
      updatedAt: 200
    }
  }
  const derived = {
    ...original,
    id: 'derived',
    derivedFromId: original.id,
    videoEdit: undefined,
    filePath: join(f.roots.recordings, 'derived.mp4')
  }
  f.commit([original, derived])
  f.trash.move(['recording', 'derived'])
  f.commit(loadLibraryIndex(f.primary, f.backup).items)
  f.trash.restore(['recording', 'derived'])
  assert.deepEqual(
    JSON.parse(JSON.stringify(f.read())),
    JSON.parse(JSON.stringify([original, derived]))
  )
})

test('production Trash pages and search stay separate from active captures and legacy OCR work', async (t) => {
  const f = await fixture(t)
  const records = Array.from({ length: 126 }, (_, index) => ({
    ...f.item,
    id: `item-${index}`,
    createdAt: 1000 + index,
    filePath: join(f.roots.captures, `item-${index}.png`),
    deletedAt: index < 125 ? 2000 : undefined,
    title: `Invoice ${index}`,
    ocrVersion: undefined
  }))
  f.commit(records)
  const store = await productionStore(f)
  assert.deepEqual(
    store.ocrUpgradeBatch(10).map((item) => item.id),
    ['item-125']
  )
  const first = await store.list({ trashed: true, limit: 120 })
  const second = await store.list({ trashed: true, offset: 120, limit: 120 })
  assert.equal(first.length, 120)
  assert.equal(second.length, 5)
  assert.equal(new Set([...first, ...second].map((item) => item.id)).size, 125)
  assert.equal((await store.list())[0].id, 'item-125')
  assert.equal((await store.list({ trashed: true, search: '"Invoice 124"' }))[0].id, 'item-124')
  store.restore(['item-124'])
  assert.equal(store.ocrUpgradeBatch(10).length, 2)
})

test('Trash orders by deletion time while restored items keep their capture dates', async (t) => {
  const f = await fixture(t)
  f.commit([
    { ...f.item, id: 'old-capture', createdAt: 10, deletedAt: 5000 },
    { ...f.item, id: 'new-capture', createdAt: 1000, deletedAt: 2000 }
  ])
  const store = await productionStore(f)
  assert.deepEqual(
    (await store.list({ trashed: true })).map((item) => item.id),
    ['old-capture', 'new-capture']
  )
  store.restore(['old-capture', 'new-capture'])
  assert.deepEqual(
    (await store.list()).map((item) => item.id),
    ['new-capture', 'old-capture']
  )
})
