import test from 'node:test'
import assert from 'node:assert/strict'
import { load, makePage, viewport } from './helpers.mjs'

const { estimateScroll, planStitch, composite } = await load('stitch')

const WIDTH = 200
const VIEW = 200

test('measures a plain scroll', () => {
  const page = makePage(WIDTH, 1000)
  const a = viewport(page, 0, VIEW)
  const b = viewport(page, 50, VIEW)
  assert.equal(estimateScroll(a, b), 50)
})

test('measures a large scroll', () => {
  const page = makePage(WIDTH, 1000)
  assert.equal(estimateScroll(viewport(page, 0, VIEW), viewport(page, 120, VIEW)), 120)
})

test('reports zero when nothing moved', () => {
  const page = makePage(WIDTH, 1000)
  const a = viewport(page, 30, VIEW)
  assert.equal(estimateScroll(a, viewport(page, 30, VIEW)), 0)
})

test('is not fooled by a sticky header', () => {
  // The header band is byte-identical in both frames. Matching on the whole frame
  // would pin the offset at zero; the template comes from the middle instead.
  const page = makePage(WIDTH, 1000, { stickyHeader: 40 })
  const a = viewport(page, 0, VIEW, { stickyHeader: 40 })
  const b = viewport(page, 60, VIEW, { stickyHeader: 40 })
  assert.equal(estimateScroll(a, b), 60)
})

test('a sticky header taller than the upper template does not win', () => {
  // The adversarial case for the two-template search: the 25% template lands *inside*
  // the repeated header and reports a perfect match at zero. The 55% template sees real
  // content, and taking the larger offset is what makes the real one win.
  const page = makePage(WIDTH, 1000, { stickyHeader: 70 })
  const a = viewport(page, 0, VIEW, { stickyHeader: 70 })
  const b = viewport(page, 45, VIEW, { stickyHeader: 70 })
  assert.equal(estimateScroll(a, b), 45)
})

test('measures a scroll of more than half the viewport', () => {
  // A template taken only from the middle of the frame caps the measurable scroll at
  // ~37% of the viewport; anything faster used to silently stitch as a duplicate.
  const page = makePage(WIDTH, 1000)
  assert.equal(estimateScroll(viewport(page, 0, VIEW), viewport(page, 110, VIEW)), 110)
})

test('plans the height of a three-frame stitch', () => {
  const page = makePage(WIDTH, 1000)
  const frames = [viewport(page, 0, VIEW), viewport(page, 50, VIEW), viewport(page, 100, VIEW)]
  const plan = planStitch(frames)
  assert.deepEqual(plan.offsets, [50, 50])
  assert.equal(plan.totalHeight, 300)
  assert.equal(plan.framesUsed, 3)
})

test('a duplicate frame contributes nothing', () => {
  const page = makePage(WIDTH, 1000)
  const frames = [viewport(page, 0, VIEW), viewport(page, 0, VIEW), viewport(page, 40, VIEW)]
  const plan = planStitch(frames)
  assert.deepEqual(plan.offsets, [0, 40])
  assert.equal(plan.totalHeight, 240)
  assert.equal(plan.framesUsed, 2)
})

test('the composited buffer reproduces the original page', () => {
  const page = makePage(WIDTH, 1000)
  const frames = [viewport(page, 0, VIEW), viewport(page, 50, VIEW), viewport(page, 100, VIEW)]
  const plan = planStitch(frames)
  const out = composite(frames, plan)

  assert.equal(out.length, WIDTH * plan.totalHeight * 4)
  // Every stitched row should equal the page row it came from.
  for (const y of [0, 99, 199, 200, 250, 299]) {
    const got = out.subarray(y * WIDTH * 4, (y + 1) * WIDTH * 4)
    const want = page.data.subarray(y * WIDTH * 4, (y + 1) * WIDTH * 4)
    assert.deepEqual(got, want, `row ${y} does not match the source page`)
  }
})

test('handles a single frame', () => {
  const page = makePage(WIDTH, 1000)
  const plan = planStitch([viewport(page, 0, VIEW)])
  assert.deepEqual(plan.offsets, [])
  assert.equal(plan.totalHeight, VIEW)
})

test('handles no frames', () => {
  assert.deepEqual(planStitch([]), { offsets: [], totalHeight: 0, framesUsed: 0 })
})
