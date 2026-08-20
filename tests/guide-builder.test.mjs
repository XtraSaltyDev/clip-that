import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const guides = await import('../.cache/test/src/shared/guides.js')
const exports = await import('../.cache/test/src/shared/guide-export.js')
const validation = await import('../.cache/test/src/main/ipc/validation.js')
const guideFiles = await import('../.cache/test/src/main/store/guide-files.js')

const png = 'data:image/png;base64,iVBORw0KGgo='
const now = 1_700_000_000_000

function project(id = 'project-1') {
  return {
    version: 1,
    id,
    title: 'Project',
    createdAt: now,
    updatedAt: now,
    image: png,
    imageWidth: 100,
    imageHeight: 80,
    scaleFactor: 1,
    crop: { enabled: false, x: 0, y: 0, width: 100, height: 80 },
    shapes: [],
    canvas: {
      padding: 0,
      background: 'none',
      backgroundColor: '#0b0f14',
      gradientFrom: '#6366f1',
      gradientTo: '#ec4899',
      gradientAngle: 135,
      radius: 0,
      shadowBlur: 0,
      shadowOpacity: 0.35,
      shadowOffsetY: 18,
      tiltX: 0,
      tiltY: 0,
      borderWidth: 0,
      borderColor: '#ffffff22',
      frame: 'none',
      frameTitle: ''
    }
  }
}

function step(id, order, title = `Step ${order + 1}`) {
  return {
    version: 1,
    id,
    order,
    title,
    description: `Description ${order + 1}`,
    createdAt: now + order,
    updatedAt: now + order,
    image: png,
    imageWidth: 100,
    imageHeight: 80,
    project: project(`project-${id}`),
    thumbnail: png,
    source: { kind: 'import' }
  }
}

function guide() {
  return {
    version: 1,
    id: 'guide-1',
    title: 'Install <ClipThat> & continue',
    description: 'A safe "guide"',
    createdAt: now,
    updatedAt: now,
    steps: [step('one', 0), step('two', 1), step('three', 2)]
  }
}

test('GuideDocument v1 validates strictly and rejects unsupported versions and portable paths', () => {
  assert.equal(validation.guideDocument(guide()).steps.length, 3)
  assert.throws(() => validation.guideDocument({ ...guide(), version: 2 }), /version/)
  assert.throws(
    () => validation.guideDocument({ ...guide(), machinePath: '/Users/someone/Desktop' }),
    /field machinePath/
  )
  const badStep = { ...step('one', 0), filePath: 'C:\\Users\\someone\\capture.png' }
  assert.throws(() => validation.guideDocument({ ...guide(), steps: [badStep] }), /filePath/)
  assert.throws(() => validation.guideDocument({ ...guide(), id: '../escape' }), /guide id/)
  assert.throws(
    () =>
      validation.guideDocument({ ...guide(), steps: [{ ...step('one', 0), id: '../../escape' }] }),
    /guide step id/
  )
  assert.throws(() => validation.guideDocument({ ...guide(), title: 'x'.repeat(241) }), /title/)
})

test('guide step reorder keeps stable ids and contiguous numbering', () => {
  const original = guide().steps
  const moved = guides.moveGuideStep(original, 'three', 0)
  assert.deepEqual(
    moved.map(({ id, order }) => ({ id, order })),
    [
      { id: 'three', order: 0 },
      { id: 'one', order: 1 },
      { id: 'two', order: 2 }
    ]
  )
  assert.deepEqual(
    original.map((item) => item.id),
    ['one', 'two', 'three']
  )
})

test('HTML export escapes user text, embeds images, and preserves ordered print pages', () => {
  const html = exports.buildGuideHtml(guide())
  assert.match(html, /Install &lt;ClipThat&gt; &amp; continue/)
  assert.doesNotMatch(html, /<ClipThat>/)
  assert.equal((html.match(/<article class="step"/g) ?? []).length, 3)
  assert.ok(html.indexOf('Step 1') < html.indexOf('Step 2'))
  assert.ok(html.indexOf('Step 2') < html.indexOf('Step 3'))
  assert.match(html, /break-after:page/)
  assert.match(html, /data:image\/png;base64/)
})

test('Markdown export uses adjacent relative asset paths in step order', () => {
  const markdown = exports.buildGuideMarkdown(guide(), 'Install Guide-assets')
  assert.match(markdown, /\.\/Install%20Guide-assets\/step-01\.png/)
  assert.match(markdown, /\.\/Install%20Guide-assets\/step-03\.png/)
  assert.ok(markdown.indexOf('## 1.') < markdown.indexOf('## 3.'))
  assert.doesNotMatch(markdown, /\/Users\/|[A-Z]:\\\\/)
})

test('atomic guide JSON recovery falls back to the last good backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipthat-guide-test-'))
  const primary = join(root, 'guide.json')
  const backup = join(root, 'guide.json.bak')
  try {
    await guideFiles.atomicGuideWrite(primary, JSON.stringify({ version: 1, value: 'good' }))
    await writeFile(backup, await readFile(primary))
    await writeFile(primary, '{truncated')
    const loaded = await guideFiles.readGuideJsonWithBackup(primary, backup, (value) => value)
    assert.equal(loaded.recovered, true)
    assert.deepEqual(loaded.value, { version: 1, value: 'good' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('guide capture path is isolated from ordinary after-capture routing', async () => {
  const source = await readFile(new URL('../src/main/guides/session.ts', import.meta.url), 'utf8')
  assert.match(source, /captureWithoutRouting/)
  assert.doesNotMatch(source, /routeResult\s*\(/)
  assert.doesNotMatch(source, /copyImageToClipboard|library\.addImage/)
})

test('editor guide save returns to the exact main-owned step context', async () => {
  const [handlers, actions] = await Promise.all([
    readFile(new URL('../src/main/ipc/handlers.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/editor/actions.ts', import.meta.url), 'utf8')
  ])
  assert.match(handlers, /guideStepContext\(e\.sender\.id\)/)
  assert.match(handlers, /context\.guideId[\s\S]*context\.stepId/)
  assert.match(actions, /api\.editor\.guideContext\(\)/)
  assert.match(actions, /api\.guides\.saveEditedStep\(doc, png\)/)
})
