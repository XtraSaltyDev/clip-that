import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const geometry = await load('geometry')
const directGesture = await load('directGesture')
const { useEditor } = await load('editorStore')
const { flatten, useEditor: exportingEditor } = await load('exporting')

const close = (actual, expected, message = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-8, message)
const closePoint = (actual, expected, message = '') => {
  close(actual.x, expected.x, `${message} x`)
  close(actual.y, expected.y, `${message} y`)
}

const line = (overrides = {}) => ({
  id: 'line-1',
  type: 'arrow',
  z: 1,
  stroke: '#f00',
  strokeWidth: 4,
  points: [10, 20, 30, 20],
  endHead: true,
  curve: 0,
  ...overrides
})

const rectangle = (overrides = {}) => ({
  id: 'rect-1',
  type: 'rect',
  z: 1,
  stroke: '#f00',
  strokeWidth: 4,
  x: 10,
  y: 20,
  width: 40,
  height: 30,
  ...overrides
})

function documentWith(shape) {
  return {
    version: 1,
    id: 'line-doc',
    title: 'Line controls',
    createdAt: 1,
    updatedAt: 1,
    image: 'data:image/png;base64,AAAA',
    imageWidth: 400,
    imageHeight: 300,
    scaleFactor: 1,
    crop: { enabled: false, x: 0, y: 0, width: 400, height: 300 },
    shapes: [shape],
    canvas: {
      padding: 0,
      background: 'none',
      backgroundColor: '#000000',
      gradientFrom: '#000000',
      gradientTo: '#ffffff',
      gradientAngle: 0,
      radius: 0,
      shadowBlur: 0,
      shadowOpacity: 0,
      shadowOffsetY: 0,
      borderWidth: 0,
      borderColor: '#000000',
      frame: 'none',
      aspect: 'auto',
      tiltX: 0,
      tiltY: 0
    }
  }
}

function documentWithShapes(shapes) {
  return { ...documentWith(shapes[0] ?? line()), shapes }
}

function referenceControlPoints(start, middle, end, tension) {
  const d01 = Math.hypot(middle.x - start.x, middle.y - start.y)
  const d12 = Math.hypot(end.x - middle.x, end.y - middle.y)
  const denominator = d01 + d12
  if (denominator === 0) return null
  const fa = (tension * d01) / denominator
  const fb = (tension * d12) / denominator
  return {
    before: {
      x: middle.x - fa * (end.x - start.x),
      y: middle.y - fa * (end.y - start.y)
    },
    after: {
      x: middle.x + fb * (end.x - start.x),
      y: middle.y + fb * (end.y - start.y)
    }
  }
}

function referenceTensionSegments(points, tension = 0.4) {
  const values = []
  for (let index = 0; index + 1 < points.length; index += 2) {
    values.push({ x: points[index], y: points[index + 1] })
  }
  if (values.length < 2 || tension === 0 || values.length < 3) {
    return values.slice(1).map((end, index) => ({
      kind: 'line',
      start: values[index],
      end
    }))
  }

  const controls = []
  for (let index = 1; index < values.length - 1; index += 1) {
    const control = referenceControlPoints(
      values[index - 1],
      values[index],
      values[index + 1],
      tension
    )
    if (!control) {
      return values.slice(1).map((end, lineIndex) => ({
        kind: 'line',
        start: values[lineIndex],
        end
      }))
    }
    controls.push(control)
  }

  const segments = [
    {
      kind: 'quadratic',
      start: values[0],
      control: controls[0].before,
      end: values[1]
    }
  ]
  for (let index = 1; index < controls.length; index += 1) {
    segments.push({
      kind: 'cubic',
      start: values[index],
      control1: controls[index - 1].after,
      control2: controls[index].before,
      end: values[index + 1]
    })
  }
  segments.push({
    kind: 'quadratic',
    start: values[values.length - 2],
    control: controls[controls.length - 1].after,
    end: values[values.length - 1]
  })
  return segments
}

function referencePoint(segment, t) {
  const inverse = 1 - t
  if (segment.kind === 'line') {
    return {
      x: inverse * segment.start.x + t * segment.end.x,
      y: inverse * segment.start.y + t * segment.end.y
    }
  }
  if (segment.kind === 'quadratic') {
    return {
      x:
        inverse * inverse * segment.start.x +
        2 * inverse * t * segment.control.x +
        t * t * segment.end.x,
      y:
        inverse * inverse * segment.start.y +
        2 * inverse * t * segment.control.y +
        t * t * segment.end.y
    }
  }
  return {
    x:
      inverse ** 3 * segment.start.x +
      3 * inverse ** 2 * t * segment.control1.x +
      3 * inverse * t * t * segment.control2.x +
      t ** 3 * segment.end.x,
    y:
      inverse ** 3 * segment.start.y +
      3 * inverse ** 2 * t * segment.control1.y +
      3 * inverse * t * t * segment.control2.y +
      t ** 3 * segment.end.y
  }
}

function referencePath(points, tension = 0.4, steps = 240) {
  return referenceTensionSegments(points, tension).flatMap((segment) =>
    Array.from({ length: steps + 1 }, (_, index) => referencePoint(segment, index / steps))
  )
}

function recoveryCenters(rects) {
  return rects.map((rect) => ({
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2
  }))
}

function nearestDistance(point, candidates) {
  return Math.min(
    ...candidates.map((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y))
  )
}

function renderedLinePoints(shape) {
  const points = [...shape.points]
  if (shape.curve && points.length === 4) {
    const control = geometry.lineCurvePoint(points, shape.curve)
    return [points[0], points[1], control.x, control.y, points[2], points[3]]
  }
  return points
}

test('direct endpoint patches keep the opposite endpoint mathematically fixed', () => {
  const original = line()
  const tail = geometry.endpointEditPatch(original, 'start', { x: 2, y: 8 })
  assert.deepEqual(tail.points, [2, 8, 30, 20])
  assert.equal(tail.rotation, 0)

  const head = geometry.endpointEditPatch(original, 'end', { x: 80, y: 60 })
  assert.deepEqual(head.points, [10, 20, 80, 60])
  assert.equal(head.rotation, 0)
})

test('body dragging translates every point pair and preserves a curved bow', () => {
  const original = line({ points: [0, 0, 40, 0, 60, 20], curve: undefined })
  assert.deepEqual(geometry.bodyDragPatch(original, 7, -3), {
    points: [7, -3, 47, -3, 67, 17],
    rotation: 0
  })

  const curved = line({ points: [0, 0, 100, 0], curve: 20 })
  const moved = geometry.bodyDragPatch(curved, 12, 8)
  assert.deepEqual(moved, { points: [12, 8, 112, 8], rotation: 0 })
  closePoint(geometry.lineCurvePoint(moved.points, curved.curve), { x: 62, y: 28 })
})

test('horizontal, vertical, diagonal, reversed, zero, and near-zero geometry stays valid', () => {
  const cases = [
    [
      [0, 0, 40, 0],
      [20, 20]
    ],
    [
      [0, 0, 0, 40],
      [20, 20]
    ],
    [
      [0, 0, 40, 40],
      [20, 20]
    ],
    [
      [40, 40, 0, 0],
      [20, 20]
    ],
    [
      [10, 10, 10, 10],
      [25, 30]
    ],
    [
      [10, 10, 10.00001, 10.00001],
      [25, 30]
    ]
  ]
  for (const [points, target] of cases) {
    const shape = line({ points })
    const patch = geometry.endpointEditPatch(shape, 'end', { x: target[0], y: target[1] })
    assert.equal(patch.points.length, 4)
    assert.deepEqual(patch.points.slice(0, 2), points.slice(0, 2))
    assert.deepEqual(patch.points.slice(2), target)
    assert.ok(patch.points.every(Number.isFinite))
  }
})

test('Shift constrains only the moving endpoint to the nearest 45-degree ray', () => {
  const anchor = { x: 100, y: 80 }
  const angles = [0, 45, 90, 135, 180, 225, 270, 315]
  for (const degrees of angles) {
    const radians = ((degrees + 7) * Math.PI) / 180
    const raw = { x: anchor.x + Math.cos(radians) * 50, y: anchor.y + Math.sin(radians) * 50 }
    const constrained = geometry.constrainLineEndpoint(raw, anchor)
    const expected = (degrees * Math.PI) / 180
    closePoint(constrained, {
      x: anchor.x + Math.cos(expected) * 50,
      y: anchor.y + Math.sin(expected) * 50
    })
    closePoint(
      geometry.lineEndpoint([anchor.x, anchor.y, constrained.x, constrained.y], 'start'),
      anchor
    )
  }
  assert.deepEqual(geometry.constrainLineEndpoint(anchor, anchor), anchor)
})

test('direct handle hit geometry remains constant in screen pixels at every zoom', () => {
  for (const zoom of [0.31, 0.5, 1, 1.5, 2, 4]) {
    const metrics = geometry.directHandleMetrics(zoom)
    close(metrics.radius * zoom, geometry.DIRECT_HANDLE_RADIUS_SCREEN)
    close(metrics.hitStrokeWidth * zoom, geometry.DIRECT_HANDLE_HIT_DIAMETER_SCREEN)
  }
})

test('measurement hit width remains generous and screen-constant across zoom levels', () => {
  for (const zoom of [0.31, 0.5, 1, 1.5, 2, 4]) {
    const hitWidth = geometry.measurementHitStrokeWidth(zoom, 4)
    assert.ok(hitWidth * zoom >= geometry.MEASUREMENT_HIT_DIAMETER_SCREEN)
    assert.equal(
      hitWidth,
      Math.max(4, geometry.MEASUREMENT_HIT_DIAMETER_SCREEN / Math.max(zoom, 0.05))
    )
  }
})

test('recovery follows Konva tension paths instead of a single quadratic shortcut', () => {
  const angles = [0, 45, 90, 135, 180, 270]
  const offsets = [30, -30, 140, -140]

  for (const type of ['arrow', 'measure']) {
    for (const degrees of angles) {
      const radians = (degrees * Math.PI) / 180
      const points = [
        100 - Math.cos(radians) * 100,
        100 - Math.sin(radians) * 100,
        100 + Math.cos(radians) * 100,
        100 + Math.sin(radians) * 100
      ]
      for (const curve of offsets) {
        for (const zoom of [0.5, 1, 1.25]) {
          const shape = line({ type, points, curve })
          const rects = geometry.interactiveRecoveryRects(shape, zoom)
          const centers = recoveryCenters(rects)
          const radius =
            (type === 'measure'
              ? geometry.measurementHitStrokeWidth(zoom, shape.strokeWidth)
              : geometry.interactiveHitStrokeWidth(zoom, shape.strokeWidth * 3)) / 2
          const actual = referencePath(renderedLinePoints(shape), 0.4)
          const maxGap = Math.max(...actual.map((point) => nearestDistance(point, centers)))
          const maxCandidateGap = Math.max(
            ...centers.map((point) => nearestDistance(point, actual))
          )
          assert.ok(
            maxGap <= radius + 1e-6,
            `${type} ${degrees} degrees, curve ${curve}, zoom ${zoom} gap ${maxGap} > ${radius}`
          )
          assert.ok(
            maxCandidateGap <= radius + 1e-6,
            `${type} ${degrees} degrees, curve ${curve}, zoom ${zoom} candidate gap ${maxCandidateGap} > ${radius}`
          )
        }
      }
    }
  }
})

test('the explicit 100px bow reproduction retains the rendered middle point', () => {
  const shape = line({ points: [0, 0, 200, 0], curve: 100 })
  const centers = recoveryCenters(geometry.interactiveRecoveryRects(shape, 1))
  const radius = geometry.interactiveHitStrokeWidth(1, shape.strokeWidth * 3) / 2
  assert.ok(nearestDistance({ x: 100, y: 100 }, centers) <= radius + 1e-6)
})

test('legacy rotated line recovery follows effective world-space tension geometry', () => {
  for (const rotation of [45, 90, 180, 270]) {
    const shape = line({
      points: [100, 80, 260, 80],
      curve: 140,
      rotation
    })
    const effective = geometry.effectiveLinePoints(shape)
    const actual = referencePath(renderedLinePoints({ ...shape, points: effective }), 0.4)
    const centers = recoveryCenters(geometry.interactiveRecoveryRects(shape, 1))
    const radius = geometry.interactiveHitStrokeWidth(1, shape.strokeWidth * 3) / 2
    assert.ok(
      Math.max(...actual.map((point) => nearestDistance(point, centers))) <= radius + 1e-6,
      `legacy rotation ${rotation} did not follow effective rendered geometry`
    )
  }
})

test('pen and highlighter recovery follows Konva tension paths through several bends', () => {
  const points = [0, 0, 100, 180, 200, -40, 300, 160, 420, 40]
  for (const type of ['pen', 'highlighter']) {
    for (const zoom of [0.5, 1, 1.25]) {
      const shape = {
        id: `${type}-tension`,
        type,
        z: 1,
        stroke: '#f00',
        strokeWidth: 8,
        points
      }
      const centers = recoveryCenters(geometry.interactiveRecoveryRects(shape, zoom))
      const radius = geometry.interactiveHitStrokeWidth(zoom, shape.strokeWidth) / 2
      const actual = referencePath(points, 0.4)
      const maxGap = Math.max(...actual.map((point) => nearestDistance(point, centers)))
      assert.ok(maxGap <= radius + 1e-6, `${type} zoom ${zoom} gap ${maxGap} > ${radius}`)
    }
  }
})

test('tension recovery stays finite for repeated and near-zero points', () => {
  const paths = [
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0.00001, 0.00001, 0.00002, 0],
    [10, 10, 10, 10, 40, 10, 40, 10]
  ]
  for (const points of paths) {
    const samples = geometry.sampledTensionPath(points, 0.4, 4)
    assert.ok(samples.length > 0)
    assert.ok(samples.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
    const shape = { ...line({ points, curve: 40 }), type: 'arrow' }
    const rects = geometry.interactiveRecoveryRects(shape, 1)
    assert.ok(rects.every((rect) => Object.values(rect).every(Number.isFinite)))
  }
})

test('rounded hollow outlines and empty clip regions cannot create phantom recovery hits', () => {
  const rounded = rectangle({
    x: 100,
    y: 100,
    width: 120,
    height: 80,
    cornerRadius: 40,
    fill: undefined
  })
  const roundedRects = geometry.interactiveRecoveryRects(rounded, 1)
  const roundedCenters = recoveryCenters(roundedRects)
  const hitRadius = geometry.interactiveHitStrokeWidth(1, rounded.strokeWidth) / 2
  assert.ok(nearestDistance({ x: rounded.x, y: rounded.y }, roundedCenters) > hitRadius + 1)

  const clipped = line({
    points: [0, 0, 100, 0],
    clipRects: [{ x: 200, y: 200, width: 20, height: 20 }]
  })
  assert.deepEqual(geometry.interactiveRecoveryRects(clipped, 1), [])
})

test('measurement labels use one canonical normal for cardinal, diagonal, and reversed lines', () => {
  const center = { x: 100, y: 100 }
  const length = 80
  const angles = [0, 45, 90, 135, 180, 270]
  for (const degrees of angles) {
    const radians = (degrees * Math.PI) / 180
    const points = [
      center.x,
      center.y,
      center.x + Math.cos(radians) * length,
      center.y + Math.sin(radians) * length
    ]
    const reversed = [points[2], points[3], points[0], points[1]]
    const label = geometry.measurementLabelLayout(points, 14, 4, 10)
    const reversedLabel = geometry.measurementLabelLayout(reversed, 14, 4, 10)

    assert.ok(
      [label.x, label.y, label.offset, label.normal.x, label.normal.y].every(Number.isFinite)
    )
    closePoint(label.normal, reversedLabel.normal, `${degrees} degrees reversed`)
    assert.ok(label.offset > 0)
    assert.ok(label.normal.y < 0 || (Math.abs(label.normal.y) < 1e-8 && label.normal.x <= 0))
  }

  const zero = geometry.measurementLabelLayout([10, 10, 10, 10], 14, 4, 10)
  const nearZero = geometry.measurementLabelLayout([10, 10, 10.00001, 10.00001], 14, 4, 10)
  assert.ok(
    [zero.x, zero.y, zero.offset, nearZero.x, nearZero.y, nearZero.offset].every(Number.isFinite)
  )
})

test('measurement label clearance accounts for curved paths on both sides', () => {
  const center = { x: 100, y: 100 }
  const length = 120
  const angles = [0, 45, 90, 135, 180, 270]
  const curves = [-140, -30, 30, 140]

  for (const degrees of angles) {
    const radians = (degrees * Math.PI) / 180
    const points = [
      center.x,
      center.y,
      center.x + Math.cos(radians) * length,
      center.y + Math.sin(radians) * length
    ]
    for (const curve of curves) {
      for (const candidate of [points, [points[2], points[3], points[0], points[1]]]) {
        const label = geometry.measurementLabelLayout(candidate, 14, 4, 10, 80, 4, curve)
        const start = geometry.lineEndpoint(candidate, 'start')
        const end = geometry.lineEndpoint(candidate, 'end')
        const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
        const control = geometry.lineCurvePoint(candidate, curve)
        const projection =
          (control.x - midpoint.x) * label.normal.x + (control.y - midpoint.y) * label.normal.y
        const projectedHalfSize =
          Math.abs(label.normal.x) * (label.width / 2) +
          Math.abs(label.normal.y) * (label.height / 2)

        assert.ok(Number.isFinite(label.offset))
        assert.ok(
          label.offset - projectedHalfSize >=
            Math.max(0, projection) + Math.max(4, 10) / 2 + 4 - 1e-8,
          `${degrees} degrees, curve ${curve} leaves the curved path under the label`
        )
      }
    }
  }

  const nearZero = geometry.measurementLabelLayout(
    [10, 10, 10.00001, 10.00001],
    14,
    4,
    10,
    80,
    4,
    140
  )
  assert.ok([nearZero.x, nearZero.y, nearZero.offset].every(Number.isFinite))
})

test('measurement recovery uses the selectable hit-path bounds, not its decorative label union', () => {
  const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
  const hitWidth = geometry.measurementHitStrokeWidth(1, 4)
  const verticalHit = geometry.lineBodyBounds([420, 40, 420, 160], hitWidth)
  const labelUnion = { left: 350, top: 40, right: 430, bottom: 160 }

  assert.deepEqual(geometry.clampTranslationToBounds(labelUnion, bounds, 24), { x: 0, y: 0 })
  assert.ok(geometry.clampTranslationToBounds(verticalHit, bounds, 24).x < 0)

  const horizontalHit = geometry.lineBodyBounds([60, 340, 180, 340], hitWidth)
  assert.ok(geometry.clampTranslationToBounds(horizontalHit, bounds, 24).y < 0)
})

test('shadowed body recovery ignores decorative shadow bounds', () => {
  const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
  const interactive = { left: 420, top: 120, right: 434, bottom: 180 }
  const withShadow = { left: 350, top: 90, right: 446, bottom: 210 }

  assert.deepEqual(geometry.clampTranslationToBounds(withShadow, bounds, 24), { x: 0, y: 0 })
  assert.ok(geometry.clampTranslationToBounds(interactive, bounds, 24).x < 0)
})

test('outline recovery follows painted perimeter instead of empty rotated bounding-box space', () => {
  const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
  const outline = rectangle({
    x: 700,
    y: 335,
    width: 350,
    height: 60,
    rotation: 142,
    fill: undefined
  })

  const recoveryRects = geometry.interactiveRecoveryRects(outline)
  assert.ok(recoveryRects.length >= 8)
  const union = geometry.unionDragRects(recoveryRects)
  assert.ok(union)

  // The old AABB path is satisfied by the empty corner of the rotated bounding box.
  assert.deepEqual(geometry.clampTranslationToBounds(union, bounds, 24), { x: 0, y: 0 })
  const correction = geometry.clampTranslationToRecoveryRects(
    recoveryRects,
    { x: 0, y: 0 },
    bounds,
    24
  )
  assert.ok(correction.x < 0 || correction.y < 0)
  assert.ok(
    recoveryRects.some((rect) => {
      const moved = geometry.translateDragRect(rect, correction)
      return moved.right >= bounds.left + 24 && moved.left <= bounds.right - 24
    })
  )
})

test('hollow ellipse recovery retains a real perimeter slice at a canvas corner', () => {
  const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
  const outline = {
    id: 'ellipse-1',
    type: 'ellipse',
    z: 1,
    stroke: '#f00',
    strokeWidth: 4,
    x: 430,
    y: 220,
    width: 220,
    height: 160,
    rotation: 24
  }
  const recoveryRects = geometry.interactiveRecoveryRects(outline)
  assert.ok(recoveryRects.length >= 12)
  const correction = geometry.clampTranslationToRecoveryRects(
    recoveryRects,
    { x: 0, y: 0 },
    bounds,
    24
  )
  assert.ok(correction.x < 0 || correction.y < 0)
})

test('multi-selection recovery keeps every member interactive, not just the union AABB', () => {
  const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
  const groups = [
    geometry.interactiveRecoveryRects(
      rectangle({ id: 'outline-a', x: 420, y: 30, width: 100, height: 80, rotation: 28 })
    ),
    geometry.interactiveRecoveryRects({
      id: 'ellipse-b',
      type: 'ellipse',
      z: 2,
      stroke: '#0f0',
      strokeWidth: 4,
      x: 40,
      y: 330,
      width: 120,
      height: 80,
      rotation: -20
    })
  ]
  const common = geometry.clampCommonTranslationToRecoveryGroups(
    groups,
    { x: 300, y: 240 },
    bounds,
    24
  )
  for (const group of groups) {
    assert.ok(
      group.some((rect) => {
        const moved = geometry.translateDragRect(rect, common)
        return (
          moved.right >= bounds.left + 24 &&
          moved.left <= bounds.right - 24 &&
          moved.bottom >= bounds.top + 24 &&
          moved.top <= bounds.bottom - 24
        )
      })
    )
  }
})

test('a selected-member click collapses while a drag preserves the provisional multi-selection', () => {
  const pending = geometry.beginProvisionalMultiSelection(['a', 'b'], 'a', false)
  assert.ok(pending)
  assert.deepEqual(geometry.finishProvisionalMultiSelection(pending, false), ['a'])
  assert.deepEqual(geometry.finishProvisionalMultiSelection(pending, true), ['a', 'b'])
  assert.equal(geometry.beginProvisionalMultiSelection(['a', 'b'], 'a', true), null)
  assert.equal(geometry.beginProvisionalMultiSelection(['a'], 'a', false), null)

  assert.deepEqual(geometry.selectionAfterPointerDown(['a', 'b'], 'a', false, true), ['a', 'b'])
  assert.deepEqual(geometry.selectionAfterPointerDown(['a', 'b'], 'a', false, false), ['a'])
  assert.deepEqual(geometry.selectionAfterPointerDown(['a', 'b'], 'a', true, false), ['b'])
  assert.deepEqual(geometry.selectionAfterPointerDown(['a', 'b'], 'c', true, false), [
    'a',
    'b',
    'c'
  ])
})

test('active body captures survive Stage mouseleave while click-only gestures clean up', () => {
  assert.equal(
    geometry.shouldContinueBodyDragAfterMouseLeave({
      captured: true,
      dragging: true,
      collective: false
    }),
    true
  )
  assert.equal(
    geometry.shouldContinueBodyDragAfterMouseLeave({
      captured: true,
      dragging: false,
      collective: true
    }),
    true
  )
  assert.equal(
    geometry.shouldContinueBodyDragAfterMouseLeave({
      captured: true,
      dragging: false,
      collective: false
    }),
    false
  )
  assert.equal(
    geometry.shouldContinueBodyDragAfterMouseLeave({
      captured: false,
      dragging: true,
      collective: false
    }),
    false
  )
})

test('leave-and-late-dragend keeps single and collective body movement clamped', () => {
  const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
  const singleShapes = [
    line({ type: 'measure', points: [120, 120, 260, 120], curve: 140 }),
    rectangle({ x: 120, y: 100, width: 140, height: 90, rotation: 35, fill: undefined })
  ]

  for (const shape of singleShapes) {
    const recoveryRects = geometry.interactiveRecoveryRects(shape, 1)
    const desired = { x: 600, y: 600 }
    const constrained = geometry.clampTranslationToRecoveryRects(
      recoveryRects,
      desired,
      bounds,
      geometry.BODY_DRAG_VISIBILITY_MARGIN_SCREEN
    )
    assert.notDeepEqual(constrained, desired, `${shape.type} lost its leave-time constraint`)
    assert.ok(
      recoveryRects.some((rect) => {
        const moved = geometry.translateDragRect(rect, constrained)
        return (
          moved.right >= bounds.left + 24 &&
          moved.left <= bounds.right - 24 &&
          moved.bottom >= bounds.top + 24 &&
          moved.top <= bounds.bottom - 24
        )
      })
    )
  }

  const groups = [
    geometry.interactiveRecoveryRects(rectangle({ id: 'a', x: 80, y: 80, width: 80, height: 60 })),
    geometry.interactiveRecoveryRects({
      id: 'b',
      type: 'ellipse',
      z: 2,
      stroke: '#0f0',
      strokeWidth: 4,
      x: 220,
      y: 140,
      width: 100,
      height: 70,
      rotation: 25
    })
  ]
  const constrained = geometry.clampCommonTranslationToRecoveryGroups(
    groups,
    { x: 600, y: 600 },
    bounds,
    geometry.BODY_DRAG_VISIBILITY_MARGIN_SCREEN
  )
  assert.notDeepEqual(constrained, { x: 600, y: 600 })
  for (const group of groups) {
    assert.ok(
      group.some((rect) => {
        const moved = geometry.translateDragRect(rect, constrained)
        return (
          moved.right >= bounds.left + 24 &&
          moved.left <= bounds.right - 24 &&
          moved.bottom >= bounds.top + 24 &&
          moved.top <= bounds.bottom - 24
        )
      })
    )
  }
})

test('interactive recovery geometry covers every draggable annotation family and ignores shadows', () => {
  const shapes = [
    line({ type: 'arrow', shadow: true, shadowBlur: 80, shadowOffsetX: 900 }),
    line({ type: 'line' }),
    line({ type: 'measure' }),
    { id: 'pen', type: 'pen', z: 1, stroke: '#f00', strokeWidth: 8, points: [10, 10, 30, 30] },
    {
      id: 'highlighter',
      type: 'highlighter',
      z: 2,
      stroke: '#f00',
      strokeWidth: 20,
      points: [10, 10, 30, 30]
    },
    rectangle({ id: 'filled-rect', fill: '#fff' }),
    {
      id: 'ellipse',
      type: 'ellipse',
      z: 3,
      stroke: '#f00',
      strokeWidth: 4,
      x: 10,
      y: 20,
      width: 80,
      height: 60
    },
    {
      id: 'blur',
      type: 'blur',
      z: 4,
      stroke: 'transparent',
      strokeWidth: 0,
      x: 10,
      y: 20,
      width: 80,
      height: 60
    },
    {
      id: 'pixelate',
      type: 'pixelate',
      z: 5,
      stroke: 'transparent',
      strokeWidth: 0,
      x: 10,
      y: 20,
      width: 80,
      height: 60
    },
    {
      id: 'redact',
      type: 'redact',
      z: 6,
      stroke: 'transparent',
      strokeWidth: 0,
      x: 10,
      y: 20,
      width: 80,
      height: 60
    },
    {
      id: 'spotlight',
      type: 'spotlight',
      z: 7,
      stroke: 'transparent',
      strokeWidth: 0,
      x: 10,
      y: 20,
      width: 80,
      height: 60
    },
    {
      id: 'magnify',
      type: 'magnify',
      z: 8,
      stroke: '#fff',
      strokeWidth: 3,
      x: 10,
      y: 20,
      width: 80,
      height: 60
    },
    {
      id: 'text',
      type: 'text',
      z: 9,
      x: 10,
      y: 20,
      width: 120,
      height: 30,
      text: 'hello',
      fontFamily: 'system-ui',
      fontSize: 20,
      color: '#fff'
    },
    {
      id: 'callout',
      type: 'callout',
      z: 10,
      x: 10,
      y: 20,
      width: 120,
      height: 40,
      text: 'hello',
      fontFamily: 'system-ui',
      fontSize: 20,
      color: '#fff'
    },
    {
      id: 'step',
      type: 'step',
      z: 11,
      x: 40,
      y: 50,
      radius: 20,
      index: 1,
      fill: '#f00',
      color: '#fff',
      fontSize: 16
    }
  ]

  for (const shape of shapes) {
    const rects = geometry.interactiveRecoveryRects(shape, 0.5)
    assert.ok(rects.length > 0, `${shape.type} has no recovery geometry`)
    const extent = geometry.unionDragRects(rects)
    assert.ok(extent)
    assert.ok(extent.right < 500, `${shape.type} used the decorative shadow as its body`)
  }
})

test('every draggable family keeps an actual recovery hit at every corner and zoom', () => {
  const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
  const base = { x: 140, y: 100 }
  const families = [
    line({ type: 'arrow', points: [base.x, base.y, base.x + 60, base.y + 40] }),
    line({ type: 'line', points: [base.x, base.y, base.x + 60, base.y + 40] }),
    line({ type: 'measure', points: [base.x, base.y, base.x + 60, base.y + 40] }),
    { id: 'pen-edge', type: 'pen', z: 1, stroke: '#f00', strokeWidth: 8, points: [base.x, base.y] },
    {
      id: 'highlighter-edge',
      type: 'highlighter',
      z: 2,
      stroke: '#f00',
      strokeWidth: 20,
      points: [base.x, base.y, base.x + 60, base.y + 40]
    },
    rectangle({ id: 'outline-edge', x: base.x, y: base.y, width: 60, height: 40, rotation: 35 }),
    {
      id: 'ellipse-edge',
      type: 'ellipse',
      z: 3,
      stroke: '#f00',
      strokeWidth: 4,
      x: base.x,
      y: base.y,
      width: 60,
      height: 40,
      rotation: 35
    },
    ...['blur', 'pixelate', 'redact', 'magnify', 'spotlight'].map((type, index) => ({
      id: `${type}-edge`,
      type,
      z: 4 + index,
      stroke: '#fff',
      strokeWidth: 3,
      x: base.x,
      y: base.y,
      width: 60,
      height: 40,
      rotation: 35,
      shadow: true,
      shadowBlur: 80,
      shadowOffsetX: 900
    })),
    {
      id: 'text-edge',
      type: 'text',
      z: 10,
      x: base.x,
      y: base.y,
      width: 90,
      height: 24,
      text: 'hello',
      fontFamily: 'system-ui',
      fontSize: 20,
      color: '#fff',
      rotation: 35
    },
    {
      id: 'callout-edge',
      type: 'callout',
      z: 11,
      x: base.x,
      y: base.y,
      width: 90,
      height: 40,
      text: 'hello',
      fontFamily: 'system-ui',
      fontSize: 20,
      color: '#fff',
      rotation: 35
    },
    {
      id: 'step-edge',
      type: 'step',
      z: 12,
      x: base.x + 30,
      y: base.y + 20,
      radius: 20,
      index: 1,
      fill: '#f00',
      color: '#fff',
      fontSize: 16,
      rotation: 35
    }
  ]
  const desiredByCorner = [
    { x: 300, y: 220 },
    { x: -300, y: 220 },
    { x: 300, y: -220 },
    { x: -300, y: -220 }
  ]

  for (const zoom of [0.5, 1, 1.25]) {
    const margin = geometry.BODY_DRAG_VISIBILITY_MARGIN_SCREEN / zoom
    for (const shape of families) {
      const recoveryRects = geometry.interactiveRecoveryRects(shape, zoom)
      assert.ok(recoveryRects.length > 0, `${shape.type} has no real hit geometry`)
      for (const desired of desiredByCorner) {
        const correction = geometry.clampTranslationToRecoveryRects(
          recoveryRects,
          desired,
          bounds,
          margin
        )
        assert.ok(
          recoveryRects.some((rect) => {
            const moved = geometry.translateDragRect(rect, correction)
            return (
              moved.right >= bounds.left + margin - 1e-8 &&
              moved.left <= bounds.right - margin + 1e-8 &&
              moved.bottom >= bounds.top + margin - 1e-8 &&
              moved.top <= bounds.bottom - margin + 1e-8
            )
          }),
          `${shape.type} lost its real hit at zoom ${zoom} for ${JSON.stringify(desired)}`
        )
      }
    }
  }
})

test('diagonal line bodies retain a clickable slice at every canvas corner', () => {
  const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
  const margin = 24
  const cases = [
    [-120, -90, -50, -30],
    [450, -90, 520, -30],
    [-120, 340, -50, 410],
    [450, 340, 520, 410]
  ]

  for (const points of cases) {
    const rect = geometry.lineBodyBounds(points, geometry.measurementHitStrokeWidth(1, 4))
    const correction = geometry.clampTranslationToBounds(rect, bounds, margin)
    const moved = geometry.translateDragRect(rect, correction)
    assert.ok(
      moved.right >= bounds.left + margin || moved.left <= bounds.right - margin,
      `${points} keeps horizontal recovery geometry visible`
    )
    assert.ok(
      moved.bottom >= bounds.top + margin || moved.top <= bounds.bottom - margin,
      `${points} keeps vertical recovery geometry visible`
    )
  }
})

test('body drag visibility clamp preserves a recoverable slice at every canvas edge', () => {
  const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
  const margin = 24
  assert.deepEqual(
    geometry.clampTranslationToBounds(
      { left: -100, top: 40, right: -20, bottom: 80 },
      bounds,
      margin
    ),
    { x: 44, y: 0 }
  )
  assert.deepEqual(
    geometry.clampTranslationToBounds(
      { left: 460, top: 340, right: 520, bottom: 440 },
      bounds,
      margin
    ),
    { x: -84, y: -64 }
  )
  assert.deepEqual(
    geometry.clampTranslationToBounds(
      { left: -1200, top: -900, right: 1600, bottom: 1200 },
      bounds,
      margin
    ),
    { x: 0, y: 0 }
  )

  const selected = [
    { left: -30, top: 40, right: 30, bottom: 90 },
    { left: 420, top: 180, right: 500, bottom: 240 }
  ]
  for (const rect of selected) {
    const correction = geometry.clampTranslationToBounds(rect, bounds, margin)
    assert.ok(
      rect.right + correction.x >= bounds.left + margin ||
        rect.left + correction.x <= bounds.right - margin
    )
    assert.ok(
      rect.bottom + correction.y >= bounds.top + margin ||
        rect.top + correction.y <= bounds.bottom - margin
    )
  }
})

test('body drag visibility margin is converted from screen pixels to canvas units', () => {
  const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
  const zoom = 0.5
  const screenMargin = geometry.BODY_DRAG_VISIBILITY_MARGIN_SCREEN
  const rect = { left: -200, top: 40, right: -100, bottom: 80 }
  const correction = geometry.clampTranslationToBounds(rect, bounds, screenMargin / zoom)

  close((rect.right + correction.x - bounds.left) * zoom, screenMargin)
  assert.equal(correction.y, 0)
})

test('multi-selection uses one snapped common translation and keeps every member recoverable', () => {
  const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
  const rects = [
    { left: 40, top: 40, right: 80, bottom: 80 },
    { left: 120, top: 80, right: 170, bottom: 130 }
  ]
  const union = geometry.unionDragRects(rects)
  assert.ok(union)

  const snapped = geometry.snapTranslationToLines(union, { x: 25, y: 24 }, [200], [150], 6)
  assert.deepEqual(snapped.translation, { x: 30, y: 20 })
  assert.deepEqual(snapped.guides, [{ x: 200 }, { y: 150 }])

  const zoom = 0.5
  for (const desired of [
    { x: 300, y: 220 },
    { x: -300, y: 220 },
    { x: 300, y: -220 },
    { x: -300, y: -220 }
  ]) {
    const common = geometry.clampCommonTranslationToBounds(
      rects,
      desired,
      bounds,
      geometry.BODY_DRAG_VISIBILITY_MARGIN_SCREEN / zoom
    )
    const moved = rects.map((rect) => geometry.translateDragRect(rect, common))
    assert.equal(moved[1].left - moved[0].left, rects[1].left - rects[0].left)
    assert.equal(moved[1].top - moved[0].top, rects[1].top - rects[0].top)
    for (const rect of moved) {
      assert.ok(rect.right >= bounds.left + 24 / zoom || rect.left <= bounds.right - 24 / zoom)
      assert.ok(rect.bottom >= bounds.top + 24 / zoom || rect.top <= bounds.bottom - 24 / zoom)
    }
    assert.ok(Math.abs(common.x) <= Math.abs(desired.x))
    assert.ok(Math.abs(common.y) <= Math.abs(desired.y))
  }
})

test('multi-selection body translation is one undoable transaction with equal shape deltas', () => {
  const shapes = [
    rectangle({ id: 'rect-a', x: 30, y: 40 }),
    rectangle({ id: 'rect-b', x: 130, y: 90 })
  ]
  useEditor.getState().setDoc(documentWithShapes(shapes))
  useEditor.getState().select(shapes.map((shape) => shape.id))
  const before = JSON.parse(JSON.stringify(useEditor.getState().doc.shapes))

  const delta = { x: 22, y: -14 }
  useEditor.getState().begin()
  for (const shape of shapes) {
    useEditor
      .getState()
      .updateShape(shape.id, geometry.bodyTranslationPatch(shape, delta.x, delta.y))
  }
  useEditor.getState().end()

  const moved = useEditor.getState().doc.shapes
  assert.equal(moved[1].x - moved[0].x, before[1].x - before[0].x)
  assert.equal(moved[1].y - moved[0].y, before[1].y - before[0].y)
  assert.equal(useEditor.getState().past.length, 1)

  useEditor.getState().undo()
  assert.deepEqual(useEditor.getState().doc.shapes, before)
  useEditor.getState().redo()
  assert.equal(useEditor.getState().doc.shapes[0].x, before[0].x + delta.x)
  assert.equal(useEditor.getState().doc.shapes[1].y, before[1].y + delta.y)
})

test('legacy points plus rotation are read without mutation and normalized on direct edit', () => {
  const rotations = [45, 90, 180, 270]
  for (const rotation of rotations) {
    const original = line({ points: [10, 20, 30, 20], rotation })
    const effective = geometry.effectiveLinePoints(original)
    const expected = geometry.rotatePoint({ x: 10, y: 20 }, { x: 20, y: 20 }, rotation)
    closePoint({ x: effective[0], y: effective[1] }, expected, `${rotation} degrees`)
    assert.equal(original.rotation, rotation)

    const patch = geometry.endpointEditPatch(original, 'end', { x: 70, y: 50 })
    assert.equal(patch.rotation, 0)
    assert.deepEqual(patch.points.slice(0, 2), effective.slice(0, 2))
    assert.deepEqual(patch.points.slice(2), [70, 50])
  }
})

test('curved endpoint edits preserve the perpendicular bow after crossing', () => {
  const original = line({ points: [0, 0, 100, 0], curve: 24 })
  const patch = geometry.endpointEditPatch(original, 'end', { x: -40, y: 30 })
  assert.equal(patch.curve, original.curve)
  assert.ok(Number.isFinite(geometry.lineCurvePoint(patch.points, patch.curve).x))
})

test('measurement length follows the edited endpoints', () => {
  const original = line({ type: 'measure', points: [0, 0, 3, 4] })
  assert.equal(Math.round(geometry.lineLength(original.points)), 5)
  const edited = geometry.endpointEditPatch(original, 'end', { x: 30, y: 40 })
  assert.equal(Math.round(geometry.lineLength(edited.points)), 50)
})

test('multi-segment line-like shapes stay on the generic path and retain all points', () => {
  const polyline = line({ points: [0, 0, 20, 10, 40, 0, 60, 20] })
  assert.equal(geometry.isDirectLineShape(polyline), false)
  assert.deepEqual(geometry.bodyDragPatch(polyline, 5, 6).points, [5, 6, 25, 16, 45, 6, 65, 26])
  assert.equal(geometry.isInteractiveDirectLineShape({ ...line(), locked: true }), false)
  assert.equal(geometry.isInteractiveDirectLineShape({ ...line(), hidden: true }), false)
})

test('one direct edit is one undoable transaction, restores legacy data, and survives reopen', () => {
  const original = line({ points: [10, 20, 30, 20], rotation: 45 })
  const state = useEditor.getState()
  state.setDoc(documentWith(original))
  const before = JSON.parse(JSON.stringify(useEditor.getState().doc.shapes))
  const patch = geometry.endpointEditPatch(original, 'start', { x: 4, y: 9 })

  state.begin()
  state.updateShape(original.id, patch)
  state.end()
  assert.equal(useEditor.getState().past.length, 1)
  assert.equal(useEditor.getState().doc.shapes[0].rotation, 0)
  assert.equal(useEditor.getState().doc.shapes[0].points[2] !== original.points[2], true)

  state.undo()
  assert.deepEqual(useEditor.getState().doc.shapes, before)
  state.redo()
  const normalized = JSON.parse(JSON.stringify(useEditor.getState().doc.shapes))
  assert.equal(normalized[0].rotation, 0)

  useEditor.getState().setDoc(JSON.parse(JSON.stringify(useEditor.getState().doc)))
  assert.deepEqual(useEditor.getState().doc.shapes, normalized)
})

test('direct gesture snapshots retain the image reference without serializing it', () => {
  const imageSentinel = Object.freeze({
    toJSON() {
      throw new Error('direct gesture capture must not serialize the image payload')
    }
  })
  const document = documentWith(line())
  document.image = imageSentinel
  useEditor.getState().setDoc(document)

  const current = useEditor.getState()
  const snapshot = directGesture.captureDirectGestureSnapshot(current)
  const restored = directGesture.restoreDirectGestureSnapshot(snapshot)

  assert.equal(snapshot.doc, current.doc)
  assert.equal(snapshot.doc.image, imageSentinel)
  assert.equal(restored.doc, current.doc)
  assert.equal(restored.doc.image, imageSentinel)
  assert.equal(restored.past, current.past)
  assert.equal(restored.future, current.future)
})

const stateSnapshot = () => {
  const state = useEditor.getState()
  return {
    doc: JSON.parse(JSON.stringify(state.doc)),
    past: state.past,
    future: state.future,
    dirty: state.dirty,
    selectedIds: [...state.selectedIds],
    editingTextId: state.editingTextId
  }
}

const restoreCancelled = (snapshot, id, latePatch) => {
  const marker = directGesture.cancelDirectGesture({ id, cancelled: false })
  useEditor.setState(directGesture.restoreDirectGestureSnapshot(snapshot))
  if (!directGesture.isCancelledDirectGesture(marker, id)) {
    useEditor.getState().updateShape(id, latePatch)
  }
}

test('endpoint Escape restores geometry, dirty state, and history without a redo entry', () => {
  const original = line({ rotation: 45 })
  useEditor.getState().setDoc(documentWith(original))
  useEditor.getState().select([original.id])
  const before = stateSnapshot()
  const snapshot = directGesture.captureDirectGestureSnapshot(useEditor.getState())

  useEditor.getState().begin()
  useEditor
    .getState()
    .updateShape(original.id, geometry.endpointEditPatch(original, 'start', { x: 2, y: 8 }))
  restoreCancelled(
    snapshot,
    original.id,
    geometry.endpointEditPatch(original, 'end', { x: 80, y: 90 })
  )

  assert.deepEqual(stateSnapshot(), before)
  assert.equal(useEditor.getState().past.length, 0)
  assert.equal(useEditor.getState().future.length, 0)
})

test('curve Escape restores the original curve and legacy rotation exactly', () => {
  const original = line({ rotation: 90, curve: 24 })
  useEditor.getState().setDoc(documentWith(original))
  useEditor.getState().select([original.id])
  const before = stateSnapshot()
  const snapshot = directGesture.captureDirectGestureSnapshot(useEditor.getState())

  useEditor.getState().begin()
  const effective = geometry.effectiveLinePoints(original)
  const changed = geometry.normalizedLinePatch(original, effective)
  changed.curve = -40
  useEditor.getState().updateShape(original.id, changed)
  restoreCancelled(snapshot, original.id, changed)

  assert.deepEqual(stateSnapshot(), before)
  assert.equal(useEditor.getState().doc.shapes[0].rotation, 90)
  assert.equal(useEditor.getState().doc.shapes[0].curve, 24)
})

test('body Escape before a late dragEnd keeps legacy geometry and history untouched', () => {
  const original = line({ rotation: 180 })
  useEditor.getState().setDoc(documentWith(original))
  useEditor.getState().select([original.id])
  const before = stateSnapshot()
  const snapshot = directGesture.captureDirectGestureSnapshot(useEditor.getState())

  useEditor.getState().begin()
  // Body dragging defers the document patch until Konva dragEnd.
  restoreCancelled(snapshot, original.id, geometry.bodyDragPatch(original, 20, 0))

  assert.deepEqual(stateSnapshot(), before)
  assert.equal(useEditor.getState().past.length, before.past.length)
  assert.equal(useEditor.getState().future.length, before.future.length)
})

test('mouse-leave cancellation suppresses a subsequent body dragEnd', () => {
  const original = line({ rotation: 270 })
  useEditor.getState().setDoc(documentWith(original))
  useEditor.getState().select([original.id])
  const before = stateSnapshot()
  const snapshot = directGesture.captureDirectGestureSnapshot(useEditor.getState())

  useEditor.getState().begin()
  restoreCancelled(snapshot, original.id, geometry.bodyDragPatch(original, -18, 12))

  assert.deepEqual(stateSnapshot(), before)
  assert.equal(
    directGesture.isCancelledDirectGesture({ id: original.id, cancelled: true }, original.id),
    true
  )
})

test('cancellation preserves an existing redo branch instead of consuming it', () => {
  const original = line()
  useEditor.getState().setDoc(documentWith(original))
  useEditor.getState().begin()
  useEditor.getState().updateShape(original.id, { strokeWidth: 8 })
  useEditor.getState().end()
  useEditor.getState().undo()
  useEditor.getState().select([original.id])
  const before = stateSnapshot()
  assert.equal(before.past.length, 0)
  assert.equal(before.future.length, 1)

  const snapshot = directGesture.captureDirectGestureSnapshot(useEditor.getState())
  useEditor.getState().begin()
  useEditor
    .getState()
    .updateShape(original.id, geometry.endpointEditPatch(original, 'start', { x: -9, y: 4 }))
  restoreCancelled(snapshot, original.id, geometry.bodyDragPatch(original, 20, 0))

  assert.deepEqual(stateSnapshot(), before)
  assert.equal(useEditor.getState().future.length, 1)
  useEditor.getState().redo()
  assert.equal(useEditor.getState().doc.shapes[0].strokeWidth, 8)
})

test('cancellation preserves both clean and already-dirty documents', () => {
  const clean = line()
  useEditor.getState().setDoc(documentWith(clean))
  useEditor.getState().select([clean.id])
  const cleanSnapshot = directGesture.captureDirectGestureSnapshot(useEditor.getState())
  useEditor.getState().begin()
  useEditor
    .getState()
    .updateShape(clean.id, geometry.endpointEditPatch(clean, 'end', { x: 70, y: 40 }))
  useEditor.setState(directGesture.restoreDirectGestureSnapshot(cleanSnapshot))
  assert.equal(useEditor.getState().dirty, false)
  assert.equal(useEditor.getState().past.length, 0)
  assert.equal(useEditor.getState().future.length, 0)

  const dirty = line({ stroke: '#00f' })
  useEditor.getState().setDoc(documentWith(dirty))
  useEditor.getState().select([dirty.id])
  useEditor.getState().begin()
  useEditor.getState().updateShape(dirty.id, { strokeWidth: 8 })
  useEditor.getState().end()
  const dirtyBefore = stateSnapshot()
  const dirtySnapshot = directGesture.captureDirectGestureSnapshot(useEditor.getState())
  useEditor.getState().begin()
  useEditor
    .getState()
    .updateShape(dirty.id, geometry.endpointEditPatch(dirty, 'start', { x: -4, y: 12 }))
  useEditor.setState(directGesture.restoreDirectGestureSnapshot(dirtySnapshot))
  assert.deepEqual(stateSnapshot(), dirtyBefore)
  assert.equal(useEditor.getState().dirty, true)
})

test('normal endpoint, curve, and body releases remain one-step undoable transactions', () => {
  const cases = [
    (shape) => geometry.endpointEditPatch(shape, 'end', { x: 80, y: 45 }),
    (shape) => ({
      ...geometry.normalizedLinePatch(shape, geometry.effectiveLinePoints(shape)),
      curve: 30
    }),
    (shape) => geometry.bodyDragPatch(shape, 12, -7)
  ]

  for (const makePatch of cases) {
    const original = line({ rotation: 45, curve: 10 })
    useEditor.getState().setDoc(documentWith(original))
    const before = JSON.parse(JSON.stringify(original))
    useEditor.getState().begin()
    useEditor.getState().updateShape(original.id, makePatch(original))
    useEditor.getState().end()
    assert.equal(useEditor.getState().past.length, 1)
    useEditor.getState().undo()
    assert.deepEqual(useEditor.getState().doc.shapes[0], before)
    assert.equal(useEditor.getState().future.length, 1)
    useEditor.getState().redo()
    assert.equal(useEditor.getState().past.length, 1)
    assert.equal(useEditor.getState().future.length, 0)
  }
})

test('flatten clears direct selection before capture and restores it afterward', async () => {
  const previousAnimationFrame = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  try {
    const shape = line({ id: 'export-arrow' })
    exportingEditor.getState().setDoc(documentWith(shape))
    exportingEditor.getState().select([shape.id])
    const selectionsAtCapture = []
    const stage = {
      toDataURL: () => {
        selectionsAtCapture.push([...exportingEditor.getState().selectedIds])
        return 'data:image/png;base64,flattened'
      }
    }

    assert.equal(await flatten(stage), 'data:image/png;base64,flattened')
    assert.deepEqual(selectionsAtCapture, [[]])
    assert.deepEqual(exportingEditor.getState().selectedIds, [shape.id])
  } finally {
    globalThis.requestAnimationFrame = previousAnimationFrame
  }
})
