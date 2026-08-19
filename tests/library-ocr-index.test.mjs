import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from './helpers.mjs'

const quality = await load('src/shared/ocr-quality.js')
const indexOcr = await load('src/main/store/library-ocr.js')

const word = (text, confidence, x, y, width = Math.max(18, text.length * 8), height = 18) => ({
  text,
  confidence,
  bbox: { x, y, width, height }
})
const result = (words) => ({ text: words.map((entry) => entry.text).join(' '), words })
const item = (overrides = {}) => ({
  id: overrides.id ?? 'capture-1',
  title: 'Quarterly capture',
  createdAt: 100,
  updatedAt: 200,
  kind: 'image',
  width: 1200,
  height: 800,
  filePath: '/tmp/capture.png',
  projectPath: '/tmp/capture.clipthat',
  thumbnail: '/tmp/thumb.png',
  tags: ['finance', 'review'],
  favorite: true,
  byteSize: 12345,
  ...overrides
})

test('background indexing stores clean multi-line text and legitimate short content', () => {
  const clean = result([
    word('Quarterly', 96, 10, 10),
    word('report', 95, 100, 10),
    word('Ready', 94, 10, 40),
    word('https://clipthat.app/docs', 92, 10, 70),
    word('£42.00', 93, 10, 100)
  ])
  const text = indexOcr.trustedOcrText(clean)
  assert.match(text, /Quarterly report/)
  assert.match(text, /Ready/)
  assert.match(text, /https:\/\/clipthat\.app\/docs/)
  assert.match(text, /£42\.00/)
})

test('photo noise and garbage OCR never become searchable trusted text', () => {
  const noise = result([
    word('NLR', 58, 20, 20),
    word('£0', 61, 130, 20),
    word('www..bad', 63, 260, 20),
    word('vV', 53, 20, 50),
    word('I1l', 57, 130, 50),
    word('3', 92, 260, 50)
  ])
  assert.equal(indexOcr.trustedOcrText(noise), '')
})

test('mixed OCR keeps trustworthy text and excludes uncertain fragments', () => {
  const mixed = result([
    word('Documentation', 96, 20, 20),
    word('https://clipthat.app/docs', 94, 160, 20),
    word('XQZ', 45, 20, 55),
    word('£0', 49, 160, 55)
  ])
  const text = indexOcr.trustedOcrText(mixed)
  assert.match(text, /Documentation/)
  assert.match(text, /clipthat/)
  assert.doesNotMatch(text, /XQZ|£0/)
})

test('Context and Library use exactly the same trusted-text decision', () => {
  const fixture = result([
    word('Build', 94, 10, 10),
    word('CT-2048', 91, 60, 10),
    word('artifact', 38, 10, 45)
  ])
  assert.equal(indexOcr.trustedOcrText(fixture), quality.assessOcr(fixture).trusted.text.trim())
})

test('legacy OCR is invalidated immediately and upgraded without metadata loss', () => {
  const legacy = item({ ocrText: 'NLR false landscape words £0' })
  const publicLegacy = indexOcr.publicLibraryItem(legacy)
  assert.equal(publicLegacy.ocrText, undefined)
  assert.equal(indexOcr.searchableOcrText(legacy), '')
  assert.equal(indexOcr.needsOcrUpgrade(legacy), true)

  const upgraded = indexOcr.withTrustedOcr(legacy, 'Quarterly report')
  assert.equal(upgraded.ocrVersion, quality.OCR_TRUST_VERSION)
  assert.equal(upgraded.ocrText, 'Quarterly report')
  assert.equal(indexOcr.searchableOcrText(upgraded), 'Quarterly report')
  for (const key of [
    'id',
    'title',
    'createdAt',
    'updatedAt',
    'kind',
    'width',
    'height',
    'filePath',
    'projectPath',
    'thumbnail',
    'favorite',
    'byteSize'
  ])
    assert.deepEqual(upgraded[key], legacy[key])
  assert.deepEqual(upgraded.tags, legacy.tags)
  assert.notEqual(upgraded.tags, legacy.tags)
  assert.equal(indexOcr.needsOcrUpgrade(upgraded), false)
  assert.deepEqual(indexOcr.withTrustedOcr(upgraded, upgraded.ocrText), upgraded)
})

test('unversioned recording OCR is never exposed as trusted search text', () => {
  const legacyVideo = item({
    id: 'video-1',
    kind: 'video',
    filePath: '/tmp/recording.mp4',
    ocrText: 'legacy video noise'
  })
  assert.equal(indexOcr.needsOcrUpgrade(legacyVideo), false)
  assert.equal(indexOcr.searchableOcrText(legacyVideo), '')
  assert.equal(indexOcr.publicLibraryItem(legacyVideo).ocrText, undefined)
})

test('upgrade batches are bounded, resumable, idempotent, and skip failed sources for a run', () => {
  const entries = [
    item({ id: 'done', ocrVersion: quality.OCR_TRUST_VERSION, ocrText: 'Ready' }),
    item({ id: 'missing-source', filePath: '/missing.png', ocrText: 'legacy noise' }),
    item({ id: 'pending-1', ocrText: 'legacy one' }),
    item({ id: 'pending-2', ocrText: 'legacy two' })
  ]
  const first = indexOcr.nextOcrUpgradeBatch(entries, 2)
  assert.deepEqual(
    first.map((entry) => entry.id),
    ['missing-source', 'pending-1']
  )

  const afterInterruption = entries.map((entry) =>
    entry.id === 'pending-1' ? indexOcr.withTrustedOcr(entry, 'Trusted one') : entry
  )
  const resumed = indexOcr.nextOcrUpgradeBatch(afterInterruption, 2, new Set(['missing-source']))
  assert.deepEqual(
    resumed.map((entry) => entry.id),
    ['pending-2']
  )
  assert.deepEqual(
    indexOcr.nextOcrUpgradeBatch(
      afterInterruption.map((entry) =>
        entry.id === 'pending-2' ? indexOcr.withTrustedOcr(entry, 'Trusted two') : entry
      ),
      10,
      new Set(['missing-source'])
    ),
    []
  )
})
