import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from './helpers.mjs'

const { parseLibrarySearch, matchesLibrarySearch } = await load('src/shared/library-search.js')
const { indexLibraryLineage } = await load('src/shared/library-workbench.js')
const { arrangeAnnotations } = await load('src/shared/annotation-layout.js')
const { parseTimecode, formatTimecode } = await load('src/shared/timecode.js')
const { isSaveDocumentCurrent, isSaveRevisionCurrent } = await load(
  'src/renderer/editor/save-snapshot.js'
)
const { comparisonExportRequest, libraryQuery } = await load('src/main/ipc/validation.js')

test('Library search combines words, phrases, exclusions and case-insensitive OCR lines', () => {
  const query = parseLibrarySearch('invoice "marcus bell" -draft -"past due"')
  assert.equal(matchesLibrarySearch('INVOICE\nMarcus   Bell paid', query), true)
  assert.equal(matchesLibrarySearch('invoice Marcus Bell draft', query), false)
  assert.equal(matchesLibrarySearch('invoice Marcus Bell past\ndue', query), false)
  assert.equal(matchesLibrarySearch('invoice Marcus John Bell', query), false)
  assert.equal(matchesLibrarySearch('anything', parseLibrarySearch('  ')), true)
  assert.equal(matchesLibrarySearch('ordinary capture', parseLibrarySearch('-secret')), true)
  assert.equal(matchesLibrarySearch('secret capture', parseLibrarySearch('-secret')), false)
  assert.equal(matchesLibrarySearch('quarter-final', parseLibrarySearch('quarter-final')), true)
})

test('Library lineage lookup preserves siblings and handles missing parents', () => {
  const source = { id: 'source' }
  const first = { id: 'first', derivedFromId: 'source' }
  const second = { id: 'second', derivedFromId: 'source' }
  const orphan = { id: 'orphan', derivedFromId: 'missing' }
  const index = indexLibraryLineage([source, first, second, orphan])
  assert.equal(index.byId.get('source'), source)
  assert.deepEqual(index.derived.get('source'), [first, second])
  assert.equal(index.byId.get('missing'), undefined)
  assert.deepEqual(index.derived.get('missing'), [orphan])
})

const shapes = [
  { id: 'first', type: 'rect', x: 0, y: 0, width: 10, height: 10 },
  { id: 'second', type: 'arrow', points: [20, 20, 40, 40] },
  { id: 'third', type: 'step', x: 90, y: 90, radius: 10 }
]
const bounds = {
  first: { x: 0, y: 0, width: 10, height: 10 },
  second: { x: 20, y: 20, width: 20, height: 20 },
  third: { x: 80, y: 80, width: 20, height: 20 }
}

test('alignment translates point and box geometry using painted edges and is non-destructive', () => {
  const original = structuredClone(shapes)
  assert.deepEqual(arrangeAnnotations(shapes, bounds, 'left'), {
    second: { points: [0, 20, 20, 40] },
    third: { x: 10 }
  })
  assert.deepEqual(arrangeAnnotations(shapes, bounds, 'bottom'), {
    first: { y: 90 },
    second: { points: [20, 80, 40, 100] }
  })
  assert.deepEqual(shapes, original)
})

test('distribution gives equal gaps while keeping the endpoint annotations in place', () => {
  assert.deepEqual(arrangeAnnotations(shapes, bounds, 'horizontal'), {
    second: { points: [35, 20, 55, 40] }
  })
  assert.deepEqual(arrangeAnnotations(shapes, bounds, 'vertical'), {
    second: { points: [20, 35, 40, 55] }
  })
  assert.deepEqual(arrangeAnnotations(shapes.slice(0, 2), bounds, 'horizontal'), {})
})

test('locked, hidden, or invalid annotations do not move or define alignment anchors', () => {
  const locked = [{ ...shapes[0], locked: true }, shapes[1], shapes[2]]
  assert.deepEqual(arrangeAnnotations(locked, bounds, 'left'), { third: { x: 30 } })
  assert.deepEqual(
    arrangeAnnotations([{ ...shapes[0], hidden: true }, shapes[1]], bounds, 'left'),
    {}
  )
  assert.deepEqual(
    arrangeAnnotations(
      shapes,
      { first: bounds.first, second: { ...bounds.second, x: NaN } },
      'left'
    ),
    {}
  )
})

test('timecode accepts milliseconds, long minutes, and hours and rejects numeric tricks', () => {
  for (const [text, expected] of [
    ['12.345', 12345],
    ['01:02.5', 62500],
    ['90:00', 5400000],
    ['01:02:03.125', 3723125],
    [' 0 ', 0]
  ])
    assert.equal(parseTimecode(text), expected)
  for (const text of [
    '',
    '1e3',
    '-1',
    '0x20',
    '01:60',
    '01:60:00',
    '1.5:02',
    '1::02',
    '1:2:3:4',
    '12.3456',
    'Infinity',
    '+5',
    '1: 2'
  ])
    assert.equal(parseTimecode(text), null, text)
  assert.equal(formatTimecode(59999), '01:00.0')
  assert.equal(formatTimecode(3600000), '01:00:00.0')
  assert.equal(formatTimecode(NaN), '00:00.0')
  for (const value of [0, 1200, 12345, 3723125])
    assert.ok(Math.abs(parseTimecode(formatTimecode(value)) - value) <= 50)
})

test('save acknowledgements cannot clear newer edits or link a reopened capture', () => {
  const doc = { id: 'capture', title: 'Before' }
  const saved = { doc, libraryId: 'library', epoch: 4 }
  assert.equal(isSaveRevisionCurrent({ doc, documentEpoch: 4 }, saved), true)
  const edited = { ...doc, title: 'After' }
  assert.equal(isSaveDocumentCurrent({ doc: edited, documentEpoch: 4 }, saved), true)
  assert.equal(isSaveRevisionCurrent({ doc: edited, documentEpoch: 4 }, saved), false)
  assert.equal(isSaveDocumentCurrent({ doc, documentEpoch: 5 }, saved), false)
  assert.equal(isSaveDocumentCurrent({ doc: { id: 'other' }, documentEpoch: 4 }, saved), false)
  assert.equal(isSaveDocumentCurrent({ doc: null, documentEpoch: 4 }, saved), false)
})

test('comparison export IPC requires a user-selected PNG destination and rejects internal overwrite', () => {
  const request = {
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    format: 'png',
    saveAs: true,
    suggestedName: 'Comparison'
  }
  assert.equal(comparisonExportRequest(request).saveAs, true)
  for (const patch of [{ targetPath: '/tmp/capture.png' }, { saveAs: false }, { format: 'jpg' }])
    assert.throws(
      () => comparisonExportRequest({ ...request, ...patch }),
      /Comparison exports require/
    )
  assert.throws(() => comparisonExportRequest({ ...request, overwrite: true }), /not supported/)
})

test('sort and pagination requests remain validated at the main-process boundary', () => {
  for (const sort of ['newest', 'oldest', 'title', 'size'])
    assert.equal(libraryQuery({ sort, offset: 120, limit: 120 }).sort, sort)
  assert.throws(() => libraryQuery({ sort: 'arbitrary' }), /library sort/)
  assert.throws(() => libraryQuery({ offset: -1 }), /outside the supported range/)
  assert.throws(() => libraryQuery({ limit: 1001 }), /outside the supported range/)
})
