/**
 * Deterministic editor acceptance through the real BrowserWindow → Konva → Zustand path.
 *
 * The fixture is opened with a hash-gated renderer probe. All pointer actions below are
 * BrowserWindow mouse events; the probe only reports document/lifecycle state and maps known
 * fixture points through the live canvas layout. The caller must use an isolated user-data dir.
 */
import { nativeImage, type BrowserWindow } from 'electron'
import type { ArrowShape, BoxShape, ClipDocument, Shape, ToolId } from '@shared/types'
import { DEFAULT_CANVAS } from '@shared/defaults'
import { library } from '../store/library'
import { openInEditor, openInExistingEditor } from '../capture/service'
import { editorWindows } from '../windows/manager'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (line: string) => console.log(`[selftest] editor: ${line}`)

interface EditorSnapshot {
  selectedIds: string[]
  dirty: boolean
  past: number
  future: number
  tool: string
  zoom: number
  doc: Omit<ClipDocument, 'image'> | null
  toolbarVisible: boolean
  toolbarRect: { left: number; top: number; width: number; height: number } | null
  stageRect: { left: number; top: number; width: number; height: number } | null
  viewportRect: { left: number; top: number; width: number; height: number } | null
  viewportScroll: { left: number; top: number }
  windowSize: { width: number; height: number }
}

interface Point {
  x: number
  y: number
}

interface RecoveryRect {
  left: number
  top: number
  right: number
  bottom: number
}

interface RetainedRecoveryCandidate {
  world: Point
  screen: Point
}

type RecoveryPosition =
  'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left' | 'top-left'

const RECOVERY_POSITIONS: RecoveryPosition[] = [
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
  'top-left'
]

const IDs = {
  arrow: 'selftest-arrow',
  line: 'selftest-line',
  measure: 'selftest-measure',
  rectA: 'selftest-rect-a',
  rectB: 'selftest-rect-b'
} as const

function fixtureImage(): string {
  const width = 900
  const height = 620
  const bytes = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      bytes[i] = Math.round((x / width) * 255)
      bytes[i + 1] = Math.round((y / height) * 255)
      bytes[i + 2] = 180
      bytes[i + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(bytes, { width, height }).toDataURL()
}

function fixtureDocument(): ClipDocument {
  const now = Date.now()
  return {
    version: 1,
    id: 'editor-self-test',
    title: 'ClipThat editor interaction fixture',
    createdAt: now,
    updatedAt: now,
    image: fixtureImage(),
    imageWidth: 900,
    imageHeight: 620,
    scaleFactor: 1,
    crop: { enabled: false, x: 0, y: 0, width: 900, height: 620 },
    canvas: { ...DEFAULT_CANVAS },
    shapes: [
      {
        id: IDs.arrow,
        type: 'arrow',
        z: 1,
        points: [120, 130, 320, 130],
        stroke: '#ff3b30',
        strokeWidth: 8,
        endHead: true,
        shadow: false
      },
      {
        id: IDs.line,
        type: 'line',
        z: 2,
        points: [120, 250, 320, 250],
        stroke: '#34c759',
        strokeWidth: 8,
        shadow: false
      },
      {
        id: IDs.measure,
        type: 'measure',
        z: 3,
        points: [120, 390, 320, 390],
        stroke: '#4f8cff',
        strokeWidth: 6,
        curve: 42,
        shadow: false
      },
      {
        id: IDs.rectA,
        type: 'rect',
        z: 4,
        x: 470,
        y: 120,
        width: 150,
        height: 110,
        stroke: '#ff9500',
        strokeWidth: 6,
        fill: '#ffffff66',
        shadow: true
      },
      {
        id: IDs.rectB,
        type: 'rect',
        z: 5,
        x: 680,
        y: 300,
        width: 150,
        height: 110,
        stroke: '#af52de',
        strokeWidth: 6,
        fill: '#ffffff66',
        shadow: true
      }
    ]
  }
}

function fail(message: string): never {
  throw new Error(message)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message)
}

function shapeOf(snapshot: EditorSnapshot, id: string): Shape {
  const shape = snapshot.doc?.shapes.find((candidate) => candidate.id === id)
  return shape ?? fail(`shape ${id} was not present`)
}

function pointsOf(snapshot: EditorSnapshot, id: string): number[] {
  const shape = shapeOf(snapshot, id)
  return 'points' in shape ? [...shape.points] : fail(`shape ${id} has no points`)
}

function assertPointsEqual(actual: number[], expected: number[], label: string): void {
  assert(actual.length === expected.length, `${label}: point count changed`)
  for (let i = 0; i < actual.length; i += 1) {
    assert(Math.abs(actual[i] - expected[i]) < 0.001, `${label}: point ${i} changed unexpectedly`)
  }
}

function sendMouse(
  win: BrowserWindow,
  type: 'mouseDown' | 'mouseMove' | 'mouseUp',
  point: Point,
  modifiers: string[] = []
): void {
  win.webContents.sendInputEvent({
    type,
    x: Math.round(point.x),
    y: Math.round(point.y),
    button: 'left',
    clickCount: 1,
    modifiers
  } as never)
}

async function pointerClick(
  win: BrowserWindow,
  point: Point,
  modifiers: string[] = []
): Promise<void> {
  sendMouse(win, 'mouseDown', point, modifiers)
  await wait(35)
  sendMouse(win, 'mouseUp', point, modifiers)
  await wait(180)
}

async function pointerDrag(
  win: BrowserWindow,
  from: Point,
  to: Point,
  onActive?: () => Promise<void>
): Promise<void> {
  sendMouse(win, 'mouseDown', from)
  await wait(65)
  for (let i = 1; i <= 8; i += 1) {
    sendMouse(win, 'mouseMove', {
      x: from.x + ((to.x - from.x) * i) / 8,
      y: from.y + ((to.y - from.y) * i) / 8
    })
    await wait(32)
    // Konva may deliver the first threshold-crossing move before its dragstart callback. Sample
    // the next move so this is a confirmed active gesture, never a retry after a failed click.
    if (i === 2 && onActive) {
      // Allow Konva's dragstart/toolbar-hide callbacks to flush before observing the same
      // continuous gesture. This is a settlement wait, not a retry or a second drag.
      await wait(80)
      await onActive()
    }
  }
  sendMouse(win, 'mouseUp', to)
  await wait(240)
}

async function bridgeSnapshot(win: BrowserWindow): Promise<EditorSnapshot> {
  const snapshot = await win.webContents.executeJavaScript(
    'window.__CLIPTHAT_EDITOR_SELF_TEST__?.snapshot() ?? null'
  )
  return snapshot as EditorSnapshot
}

async function transformerRotateLineVisible(win: BrowserWindow): Promise<boolean | null> {
  return (await win.webContents.executeJavaScript(
    'window.__CLIPTHAT_EDITOR_SELF_TEST__?.transformerRotateLineVisible() ?? null'
  )) as boolean | null
}

async function rotateHandlePoint(win: BrowserWindow): Promise<Point | null> {
  return (await win.webContents.executeJavaScript(
    'window.__CLIPTHAT_EDITOR_SELF_TEST__?.rotateHandle() ?? null'
  )) as Point | null
}

async function waitForBridge(win: BrowserWindow): Promise<EditorSnapshot> {
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    const snapshot = await bridgeSnapshot(win).catch(() => null)
    if (snapshot?.doc?.id === 'editor-self-test') return snapshot
    await wait(100)
  }
  fail('renderer self-test bridge did not become ready')
}

async function pointFromFixture(win: BrowserWindow, point: Point): Promise<Point> {
  const result = await win.webContents.executeJavaScript(
    `window.__CLIPTHAT_EDITOR_SELF_TEST__?.point(${JSON.stringify(point)}) ?? null`
  )
  return (result as Point | null) ?? fail(`could not map fixture point ${JSON.stringify(point)}`)
}

async function linePoint(
  win: BrowserWindow,
  id: string,
  part: 'start' | 'end' | 'curve'
): Promise<Point> {
  const result = await win.webContents.executeJavaScript(
    `window.__CLIPTHAT_EDITOR_SELF_TEST__?.linePoint(${JSON.stringify(id)}, ${JSON.stringify(part)}) ?? null`
  )
  return (result as Point | null) ?? fail(`could not map ${part} handle for ${id}`)
}

async function recoveryRects(win: BrowserWindow, id: string): Promise<RecoveryRect[]> {
  const result = await win.webContents.executeJavaScript(
    `window.__CLIPTHAT_EDITOR_SELF_TEST__?.recovery(${JSON.stringify(id)}) ?? []`
  )
  return result as RecoveryRect[]
}

async function setTool(win: BrowserWindow, tool: ToolId): Promise<void> {
  await win.webContents.executeJavaScript(
    `window.__CLIPTHAT_EDITOR_SELF_TEST__?.setTool(${JSON.stringify(tool)})`
  )
  await wait(80)
}

function recoveryCentre(rect: RecoveryRect): Point {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 }
}

function recoveryCandidate(rects: RecoveryRect[], type: Shape['type']): RecoveryRect {
  assert(rects.length > 0, `no interactive recovery geometry for ${type}`)
  // Filled rectangles deliberately expose their painted centre; line-like candidates stay on
  // the actual stroke/hit path, away from the endpoint controls where possible.
  if (type === 'rect' || type === 'ellipse' || type === 'text') return rects[rects.length - 1]
  if (type === 'measure')
    return rects[Math.min(rects.length - 1, Math.max(1, Math.floor(rects.length / 4)))]
  return rects[Math.floor(rects.length / 2)]
}

async function mappedRecoveryCandidate(
  win: BrowserWindow,
  id: string,
  type: Shape['type']
): Promise<Point> {
  const rects = await recoveryRects(win, id)
  const world = recoveryCentre(recoveryCandidate(rects, type))
  return pointFromFixture(win, world)
}

function outsideTarget(snapshot: EditorSnapshot, position: RecoveryPosition): Point {
  const viewport = snapshot.viewportRect ?? fail('missing viewport bounds')
  const windowSize = snapshot.windowSize
  const gapX = 72
  const gapY = 64
  const left = Math.max(4, viewport.left - gapX)
  const right = Math.min(windowSize.width - 4, viewport.left + viewport.width + gapX)
  const top = Math.max(4, viewport.top - gapY)
  const bottom = Math.min(windowSize.height - 4, viewport.top + viewport.height + gapY)
  const centreX = viewport.left + viewport.width / 2
  const centreY = viewport.top + viewport.height / 2
  return {
    x: position.includes('left') ? left : position.includes('right') ? right : centreX,
    y: position.startsWith('top') ? top : position.startsWith('bottom') ? bottom : centreY
  }
}

function assertTargetOutside(
  snapshot: EditorSnapshot,
  target: Point,
  position: RecoveryPosition
): void {
  const viewport = snapshot.viewportRect ?? fail('missing viewport bounds')
  const outsideX = position.includes('left')
    ? viewport.left - target.x
    : position.includes('right')
      ? target.x - (viewport.left + viewport.width)
      : 0
  const outsideY = position.startsWith('top')
    ? viewport.top - target.y
    : position.startsWith('bottom')
      ? target.y - (viewport.top + viewport.height)
      : 0
  if (position.includes('left') || position.includes('right')) {
    assert(
      outsideX >= 40,
      `target ${position} was not substantially outside horizontally: ${JSON.stringify({ target, viewport })}`
    )
  }
  if (position.startsWith('top') || position.startsWith('bottom')) {
    assert(
      outsideY >= 40,
      `target ${position} was not substantially outside vertically: ${JSON.stringify({ target, viewport })}`
    )
  }
}

async function retainedRecoveryPoint(
  win: BrowserWindow,
  snapshot: EditorSnapshot,
  id: string
): Promise<Point> {
  const points = await retainedRecoveryPoints(win, snapshot, id)
  return points[0] ?? fail(`no painted/selectable recovery slice remained visible for ${id}`)
}

async function retainedRecoveryPoints(
  win: BrowserWindow,
  snapshot: EditorSnapshot,
  id: string
): Promise<Point[]> {
  return (await retainedRecoveryCandidates(win, snapshot, id)).map((candidate) => candidate.screen)
}

async function retainedRecoveryCandidates(
  win: BrowserWindow,
  snapshot: EditorSnapshot,
  id: string
): Promise<RetainedRecoveryCandidate[]> {
  const viewport = snapshot.viewportRect ?? fail('missing viewport bounds after drag')
  const stage = snapshot.stageRect ?? fail('missing stage bounds after drag')
  const candidates: RetainedRecoveryCandidate[] = []
  for (const rect of await recoveryRects(win, id)) {
    const world = recoveryCentre(rect)
    const point = await pointFromFixture(win, world)
    // A point exactly on an overflow boundary can be reported by getBoundingClientRect while
    // the parent clips the actual event. Require a small interior margin; the production clamp
    // retains 24 screen pixels, so this does not hide a valid edge case.
    if (
      point.x >= Math.max(viewport.left, stage.left) + 5 &&
      point.x <= Math.min(viewport.left + viewport.width, stage.left + stage.width) - 5 &&
      point.y >= Math.max(viewport.top, stage.top) + 5 &&
      point.y <= Math.min(viewport.top + viewport.height, stage.top + stage.height) - 5
    ) {
      candidates.push({ world, screen: point })
    }
  }
  return candidates
}

async function blankCanvasPoint(win: BrowserWindow, snapshot: EditorSnapshot): Promise<Point> {
  const viewport = snapshot.viewportRect ?? fail('missing viewport bounds for blank-canvas click')
  const stage = snapshot.stageRect ?? fail('missing stage bounds for blank-canvas click')
  const candidates: Point[] = [
    { x: 10, y: 10 },
    { x: 145, y: 10 },
    { x: 10, y: 110 },
    { x: 145, y: 110 },
    { x: 40, y: 40 },
    { x: 650, y: 40 },
    { x: 40, y: 500 },
    { x: 650, y: 500 },
    { x: 450, y: 100 },
    { x: 450, y: 500 }
  ]
  for (const world of candidates) {
    const screen = await pointFromFixture(win, world)
    const left = Math.max(viewport.left, stage.left) + 5
    const right = Math.min(viewport.left + viewport.width, stage.left + stage.width) - 5
    const top = Math.max(viewport.top, stage.top) + 5
    const bottom = Math.min(viewport.top + viewport.height, stage.top + stage.height) - 5
    if (screen.x < left || screen.x > right || screen.y < top || screen.y > bottom) {
      continue
    }
    const toolbar = snapshot.toolbarRect
    if (
      toolbar &&
      screen.x >= toolbar.left - 4 &&
      screen.x <= toolbar.left + toolbar.width + 4 &&
      screen.y >= toolbar.top - 4 &&
      screen.y <= toolbar.top + toolbar.height + 4
    ) {
      continue
    }
    let occupied = false
    for (const shape of snapshot.doc?.shapes ?? []) {
      if ('x' in shape && 'y' in shape && 'width' in shape && 'height' in shape) {
        const height = typeof shape.height === 'number' ? shape.height : 0
        const left = Math.min(shape.x, shape.x + shape.width)
        const right = Math.max(shape.x, shape.x + shape.width)
        const top = Math.min(shape.y, shape.y + height)
        const bottom = Math.max(shape.y, shape.y + height)
        occupied = world.x >= left && world.x <= right && world.y >= top && world.y <= bottom
      }
      if (!occupied) {
        occupied = (await recoveryRects(win, shape.id)).some(
          (rect) =>
            world.x >= rect.left &&
            world.x <= rect.right &&
            world.y >= rect.top &&
            world.y <= rect.bottom
        )
      }
      if (occupied) break
    }
    if (!occupied) return screen
  }
  fail('could not find a visible blank fixture point')
}

async function testAutomaticExpansion(win: BrowserWindow): Promise<void> {
  const cases: Array<{ kind: 'arrow' | 'measure' | 'text'; position: RecoveryPosition }> = [
    { kind: 'arrow', position: 'top' },
    { kind: 'arrow', position: 'right' },
    { kind: 'arrow', position: 'bottom' },
    { kind: 'arrow', position: 'left' },
    { kind: 'arrow', position: 'bottom-right' },
    { kind: 'measure', position: 'right' },
    { kind: 'text', position: 'top-left' }
  ]
  let committed: EditorSnapshot | null = null
  let original: Shape | null = null

  // Exercise the creation path with the endpoint genuinely beyond the source Stage. The
  // production window listeners keep this raw pointer intent alive after Konva mouseleave.
  const creationFixture = { ...smallExpansionFixture(expansionShape('arrow')), shapes: [] }
  const creationBefore = await replaceFixture(win, creationFixture)
  await setZoom(win, 1)
  await resetViewportScroll(win)
  await setTool(win, 'arrow')
  const creationStart = await pointFromFixture(win, { x: 120, y: 60 })
  const creationEnd = await pointFromFixture(win, { x: 240, y: 60 })
  const creationStage =
    creationBefore.stageRect ?? fail('missing Stage bounds during creation setup')
  assert(
    creationEnd.x > creationStage.left + creationStage.width + 40,
    `creation endpoint was not outside the source Stage: ${JSON.stringify({ creationStart, creationEnd, creationStage })}`
  )
  await pointerDrag(win, creationStart, creationEnd, async () => {
    const active = await bridgeSnapshot(win)
    assert(!active.toolbarVisible, 'toolbar appeared during outside-stage annotation creation')
  })
  const creationAfter = await bridgeSnapshot(win)
  const created = creationAfter.doc?.shapes[0]
  assert(created?.type === 'arrow', 'outside-stage creation did not create an arrow')
  assert(
    'points' in created && created.points[2] > 160,
    `outside-stage creation was truncated at the source edge: ${JSON.stringify({ created, creationAfter })}`
  )
  assert(
    (creationAfter.doc?.canvas.annotationInsets?.right ?? 0) > 0 &&
      creationAfter.past === creationBefore.past + 1 &&
      creationAfter.future === 0,
    `outside-stage creation did not commit one asymmetric expansion transaction: ${JSON.stringify(creationAfter)}`
  )
  assert(creationAfter.toolbarVisible, 'toolbar did not return after outside-stage creation')
  log('outside-stage annotation creation: PASS (raw endpoint, right expansion, one history step)')

  for (const [index, item] of cases.entries()) {
    const fixture = smallExpansionFixture(expansionShape(item.kind))
    await replaceFixture(win, fixture)
    await setZoom(win, 1)
    await resetViewportScroll(win)
    await setTool(win, 'select')
    const setup = await bridgeSnapshot(win)
    const from = await mappedRecoveryCandidate(win, 'expansion-shape', item.kind)
    const stage = setup.stageRect ?? fail('missing Stage bounds during expansion setup')
    const viewport = setup.viewportRect ?? fail('missing viewport bounds during expansion setup')
    const safe = {
      left: Math.max(stage.left, viewport.left) + 5,
      right: Math.min(stage.left + stage.width, viewport.left + viewport.width) - 5,
      top: Math.max(stage.top, viewport.top) + 5,
      bottom: Math.min(stage.top + stage.height, viewport.top + viewport.height) - 5
    }
    assert(
      from.x >= safe.left && from.x <= safe.right && from.y >= safe.top && from.y <= safe.bottom,
      `${item.kind} expansion setup point was outside the live Stage/viewport intersection: ${JSON.stringify({ item, from, safe, stage, viewport, scroll: setup.viewportScroll, doc: setup.doc })}`
    )
    let before: EditorSnapshot
    try {
      before = await selectBody(win, from)
    } catch (error) {
      const failed = await bridgeSnapshot(win)
      fail(
        `${item.kind} expansion body click failed: ${JSON.stringify({
          error: String(error),
          item,
          from,
          stage: failed.stageRect,
          viewport: failed.viewportRect,
          scroll: failed.viewportScroll,
          zoom: failed.zoom,
          tool: failed.tool,
          selectedIds: failed.selectedIds,
          recovery: await recoveryRects(win, 'expansion-shape'),
          shape: failed.doc?.shapes.find((shape) => shape.id === 'expansion-shape')
        })}`
      )
    }
    const target = outsideTarget(before, item.position)
    assertTargetOutside(before, target, item.position)
    await pointerDrag(win, from, target, async () => {
      const active = await bridgeSnapshot(win)
      assert(!active.toolbarVisible, `toolbar remained visible during ${item.kind} expansion drag`)
    })

    const after = await bridgeSnapshot(win)
    const insets = after.doc?.canvas.annotationInsets
    assert(insets, `${item.kind} did not persist automatic annotation insets`)
    log(
      `automatic expansion ${item.kind}/${item.position}: canvas ${160 + insets.left + insets.right}x${120 + insets.top + insets.bottom}, insets ${JSON.stringify(insets)}`
    )
    const expected = expectedExpansionSide(item.position)
    assert(insets[expected] > 0, `${item.kind} did not grow the ${expected} side`)
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      if (
        side !== expected &&
        !item.position.includes(side === 'top' ? 'top' : side === 'bottom' ? 'bottom' : side)
      ) {
        assert(insets[side] === 0, `${item.kind} grew unrelated ${side} workspace`)
      }
    }
    assert(
      after.past === 1 && after.future === 0,
      `${item.kind} expansion was not one history step`
    )
    assert(after.toolbarVisible, `${item.kind} toolbar did not return after expansion`)

    const movedShape = shapeOf(after, 'expansion-shape')
    const blank = await blankCanvasPoint(win, after)
    await pointerClick(win, blank)
    assert((await bridgeSnapshot(win)).selectedIds.length === 0, `${item.kind} did not deselect`)
    const retained = await retainedRecoveryPoint(win, await bridgeSnapshot(win), 'expansion-shape')
    await pointerClick(win, retained)
    const reselected = await bridgeSnapshot(win)
    assert(
      reselected.selectedIds.length === 1 && reselected.selectedIds[0] === 'expansion-shape',
      `${item.kind} could not reselect its retained expanded-area body`
    )

    if (index === 1) {
      committed = reselected
      original = before.doc?.shapes.find((shape) => shape.id === 'expansion-shape') ?? null
      sendKey(win, 'z', ['cmd'])
      await wait(180)
      const undone = await bridgeSnapshot(win)
      assert(
        (undone.doc?.canvas.annotationInsets?.right ?? 0) === 0 &&
          undone.past === 0 &&
          undone.future === 1,
        'automatic expansion undo did not restore the previous canvas/history'
      )
      assert(
        original && JSON.stringify(shapeOf(undone, 'expansion-shape')) === JSON.stringify(original),
        'automatic expansion undo changed the original shape'
      )
      sendKey(win, 'z', ['cmd', 'shift'])
      await wait(180)
      committed = await bridgeSnapshot(win)
      assert(
        (committed.doc?.canvas.annotationInsets?.right ?? 0) > 0,
        'automatic expansion redo did not restore the canvas'
      )
      const rendered = await win.webContents.executeJavaScript(
        'window.__CLIPTHAT_EDITOR_SELF_TEST__?.render() ?? null'
      )
      const output = nativeImage.createFromDataURL((rendered as { dataUrl: string }).dataUrl)
      const expectedWidth =
        160 +
        (committed.doc?.canvas.annotationInsets?.left ?? 0) +
        (committed.doc?.canvas.annotationInsets?.right ?? 0)
      assert(
        output.getSize().width === expectedWidth,
        `expanded flatten width did not include the persisted workspace: ${JSON.stringify({
          output: output.getSize(),
          expectedWidth,
          insets: committed.doc?.canvas.annotationInsets,
          rendered: rendered
            ? { selectedIds: (rendered as { selectedIds: string[] }).selectedIds }
            : null
        })}`
      )
      log(
        `automatic expansion flatten output: ${output.getSize().width}x${output.getSize().height}`
      )
    }
    void movedShape
  }

  assert(committed && original, 'automatic expansion did not reach its commit checkpoint')
  const project: ClipDocument = {
    ...smallExpansionFixture(expansionShape('arrow')),
    ...committed.doc,
    image: fixtureImage(),
    updatedAt: Date.now()
  }
  const item = await library.addImage({
    dataUrl: project.image,
    title: project.title,
    width: project.imageWidth,
    height: project.imageHeight,
    project
  })
  try {
    const reopened = await library.loadProject(item.id)
    assert(reopened?.canvas.annotationInsets?.right, 'expanded workspace was not saved')
    assert(
      openInExistingEditor({ ...reopened, id: project.id }),
      'could not reopen expanded project'
    )
    await wait(320)
    const reopenedSnapshot = await waitForBridge(win)
    assert(
      reopenedSnapshot.doc?.canvas.annotationInsets?.right ===
        reopened.canvas.annotationInsets?.right,
      'reopened expanded workspace changed'
    )
    log(
      'automatic asymmetric canvas expansion: PASS (sides/corner, reselection, undo/redo, save/reopen, flatten)'
    )
  } finally {
    await library.remove([item.id])
  }
}

async function settleViewportForPosition(
  win: BrowserWindow,
  position: RecoveryPosition
): Promise<void> {
  const horizontal = position.includes('right')
    ? 'right'
    : position.includes('left')
      ? 'left'
      : 'keep'
  const vertical = position.startsWith('bottom')
    ? 'bottom'
    : position.startsWith('top')
      ? 'top'
      : 'keep'
  await win.webContents.executeJavaScript(`(() => {
    const viewport = document.querySelector('.viewport');
    if (!(viewport instanceof HTMLElement)) return;
    if (${JSON.stringify(horizontal)} === 'right') viewport.scrollLeft = viewport.scrollWidth;
    if (${JSON.stringify(horizontal)} === 'left') viewport.scrollLeft = 0;
    if (${JSON.stringify(vertical)} === 'bottom') viewport.scrollTop = viewport.scrollHeight;
    if (${JSON.stringify(vertical)} === 'top') viewport.scrollTop = 0;
  })()`)
  await wait(120)
}

async function resetViewportScroll(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(`(() => {
    const viewport = document.querySelector('.viewport');
    if (!(viewport instanceof HTMLElement)) return;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  })()`)
  // React/Konva layout and browser overflow metrics settle on separate frames.
  await wait(180)
}

async function setZoom(win: BrowserWindow, zoom: number): Promise<void> {
  await win.webContents.executeJavaScript(
    `window.__CLIPTHAT_EDITOR_SELF_TEST__?.setZoom(${JSON.stringify(zoom)})`
  )
  await wait(280)
}

async function selectBody(win: BrowserWindow, point: Point): Promise<EditorSnapshot> {
  await pointerClick(win, point)
  const snapshot = await bridgeSnapshot(win)
  assert(snapshot.selectedIds.length === 1, `body click selected ${snapshot.selectedIds.join(',')}`)
  assert(snapshot.toolbarVisible, 'selection toolbar did not appear after body click')
  return snapshot
}

async function replaceFixture(win: BrowserWindow, fixture: ClipDocument): Promise<EditorSnapshot> {
  assert(openInExistingEditor(fixture), 'could not deliver the editor fixture')
  const expectedIds = fixture.shapes.map((shape) => shape.id).sort()
  const expectedInsets = fixture.canvas.annotationInsets
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    const snapshot = await bridgeSnapshot(win).catch(() => null)
    const actualIds = snapshot?.doc?.shapes.map((shape) => shape.id).sort()
    const actualInsets = snapshot?.doc?.canvas.annotationInsets
    if (
      snapshot?.doc?.imageWidth === fixture.imageWidth &&
      snapshot.doc.imageHeight === fixture.imageHeight &&
      JSON.stringify(actualIds) === JSON.stringify(expectedIds) &&
      JSON.stringify(actualInsets) === JSON.stringify(expectedInsets)
    ) {
      await wait(180)
      return bridgeSnapshot(win)
    }
    await wait(100)
  }
  fail(
    `editor fixture did not settle: ${JSON.stringify({ expected: { imageWidth: fixture.imageWidth, imageHeight: fixture.imageHeight, ids: expectedIds, annotationInsets: expectedInsets }, actual: await bridgeSnapshot(win) })}`
  )
}

async function createLineLikeThroughEditor(
  win: BrowserWindow,
  tool: Extract<ToolId, 'arrow' | 'line' | 'measure'>,
  start: Point,
  end: Point
): Promise<{ snapshot: EditorSnapshot; shape: ArrowShape }> {
  const before = await bridgeSnapshot(win)
  const beforeIds = new Set(before.doc?.shapes.map((shape) => shape.id))
  await setTool(win, tool)
  const startScreen = await pointFromFixture(win, start)
  const endScreen = await pointFromFixture(win, end)
  await pointerDrag(win, startScreen, endScreen)
  const after = await bridgeSnapshot(win)
  const added = (after.doc?.shapes ?? []).filter((shape) => !beforeIds.has(shape.id))
  assert(added.length === 1, `${tool} creation added ${added.length} shapes`)
  const shape = added[0]
  assert(shape.type === tool, `${tool} creation produced ${shape.type}`)
  assert(
    'points' in shape && shape.points.length === 4,
    `${tool} creation did not create a segment`
  )
  assert(
    Math.hypot(shape.points[2] - shape.points[0], shape.points[3] - shape.points[1]) > 20,
    `${tool} creation produced trivial geometry`
  )
  assert(
    after.selectedIds.length === 1 && after.selectedIds[0] === shape.id,
    `${tool} was not selected`
  )
  assert(after.tool === 'select', `${tool} did not return to select mode`)
  assert(
    after.past === before.past + 1 && after.future === 0,
    `${tool} creation history was not one step`
  )
  return { snapshot: after, shape: shape as ArrowShape }
}

async function testCreationAndMeasurementReselection(
  win: BrowserWindow,
  fixture: ClipDocument
): Promise<void> {
  await replaceFixture(win, fixture)
  const arrow = await createLineLikeThroughEditor(
    win,
    'arrow',
    { x: 120, y: 500 },
    { x: 300, y: 535 }
  )
  const line = await createLineLikeThroughEditor(
    win,
    'line',
    { x: 350, y: 500 },
    { x: 540, y: 520 }
  )
  const measure = await createLineLikeThroughEditor(
    win,
    'measure',
    { x: 600, y: 500 },
    { x: 820, y: 560 }
  )
  assert(arrow.shape.type === 'arrow', 'created arrow type was not retained')
  assert(line.shape.type === 'line', 'created line type was not retained')
  const beforeDeselect = measure.snapshot
  const blank = await pointFromFixture(win, { x: 70, y: 580 })
  await pointerClick(win, blank)
  let snapshot = await bridgeSnapshot(win)
  assert(snapshot.selectedIds.length === 0, 'measurement did not deselect on blank canvas click')
  assert(snapshot.past === beforeDeselect.past, 'measurement deselection created history')

  const measureBody = await mappedRecoveryCandidate(win, measure.shape.id, 'measure')
  await pointerClick(win, measureBody)
  snapshot = await bridgeSnapshot(win)
  assert(
    snapshot.selectedIds.length === 1 && snapshot.selectedIds[0] === measure.shape.id,
    'measurement line hit did not reselect the measurement'
  )
  const beforeBody = pointsOf(snapshot, measure.shape.id)
  const beforeHistory = snapshot.past
  await pointerDrag(
    win,
    measureBody,
    { x: measureBody.x + 64, y: measureBody.y + 28 },
    async () => {
      const active = await bridgeSnapshot(win)
      assert(!active.toolbarVisible, 'measurement toolbar remained visible during body drag')
    }
  )
  snapshot = await bridgeSnapshot(win)
  const afterBody = pointsOf(snapshot, measure.shape.id)
  const dx = afterBody[0] - beforeBody[0]
  const dy = afterBody[1] - beforeBody[1]
  for (let index = 0; index < afterBody.length; index += 2) {
    assert(
      Math.abs(afterBody[index] - beforeBody[index] - dx) < 0.001,
      'measurement x pairs diverged'
    )
    assert(
      Math.abs(afterBody[index + 1] - beforeBody[index + 1] - dy) < 0.001,
      'measurement y pairs diverged'
    )
  }
  assert(
    snapshot.past === beforeHistory + 1 && snapshot.future === 0,
    'measurement body drag was not one step'
  )
  assert(snapshot.toolbarVisible, 'measurement toolbar did not return after body drag')
  log('real line/arrow/measurement creation and measurement deselect/reselect: PASS')
}

async function testEndpointAndCurve(win: BrowserWindow, fixture: ClipDocument): Promise<void> {
  let snapshot = await replaceFixture(win, fixture)
  const initialPoints = pointsOf(snapshot, IDs.arrow)
  const body = await pointFromFixture(win, { x: 220, y: 130 })
  snapshot = await selectBody(win, body)
  const start = await linePoint(win, IDs.arrow, 'start')
  const end = await linePoint(win, IDs.arrow, 'end')
  await pointerDrag(win, end, { x: end.x + 92, y: end.y + 54 }, async () => {
    const active = await bridgeSnapshot(win)
    assert(!active.toolbarVisible, 'toolbar remained visible during endpoint manipulation')
  })
  snapshot = await bridgeSnapshot(win)
  const movedPoints = pointsOf(snapshot, IDs.arrow)
  assertPointsEqual(movedPoints.slice(0, 2), initialPoints.slice(0, 2), 'arrow tail anchoring')
  assert(
    Math.hypot(movedPoints[2] - initialPoints[2], movedPoints[3] - initialPoints[3]) > 20,
    'arrow head did not move'
  )
  assert(
    snapshot.past === 1 && snapshot.future === 0,
    'endpoint edit was not one history transaction'
  )
  assert(snapshot.toolbarVisible, 'toolbar did not return after endpoint release')
  assert(Math.hypot(start.x - end.x, start.y - end.y) > 20, 'fixture arrow was too short to test')

  snapshot = await replaceFixture(win, fixture)
  const startBefore = pointsOf(snapshot, IDs.arrow)
  await selectBody(win, await pointFromFixture(win, { x: 220, y: 130 }))
  const tail = await linePoint(win, IDs.arrow, 'start')
  await pointerDrag(win, tail, { x: tail.x - 78, y: tail.y + 46 }, async () => {
    const active = await bridgeSnapshot(win)
    assert(!active.toolbarVisible, 'toolbar remained visible during tail manipulation')
  })
  snapshot = await bridgeSnapshot(win)
  const movedTailPoints = pointsOf(snapshot, IDs.arrow)
  assertPointsEqual(movedTailPoints.slice(2), startBefore.slice(2), 'arrow head anchoring')
  assert(
    Math.hypot(movedTailPoints[0] - startBefore[0], movedTailPoints[1] - startBefore[1]) > 20,
    'arrow tail did not move'
  )
  assert(snapshot.past === 1 && snapshot.future === 0, 'tail edit was not one history transaction')
  assert(snapshot.toolbarVisible, 'toolbar did not return after tail release')

  snapshot = await replaceFixture(win, fixture)
  const measureCurvePoint = await linePoint(win, IDs.measure, 'curve')
  await selectBody(win, measureCurvePoint)
  const beforeMeasure = pointsOf(snapshot, IDs.measure)
  const curveHandle = await linePoint(win, IDs.measure, 'curve')
  await pointerDrag(win, curveHandle, { x: curveHandle.x, y: curveHandle.y + 62 }, async () => {
    const active = await bridgeSnapshot(win)
    assert(!active.toolbarVisible, 'toolbar remained visible during curve manipulation')
  })
  snapshot = await bridgeSnapshot(win)
  assertPointsEqual(
    pointsOf(snapshot, IDs.measure),
    beforeMeasure,
    'measurement endpoints during curve edit'
  )
  const measure = shapeOf(snapshot, IDs.measure) as ArrowShape
  assert(Math.abs((measure.curve ?? 0) - 42) > 2, 'measurement curve did not change')
  assert(snapshot.past === 1 && snapshot.future === 0, 'curve edit was not one history transaction')
  assert(snapshot.toolbarVisible, 'toolbar did not return after curve release')
  log(
    'endpoint and curve gestures: PASS (both endpoints, curve, active toolbar hidden, one-step history)'
  )
}

async function testCancellationAndBody(win: BrowserWindow, fixture: ClipDocument): Promise<void> {
  let snapshot = await replaceFixture(win, fixture)
  const before = pointsOf(snapshot, IDs.arrow)
  await selectBody(win, await pointFromFixture(win, { x: 220, y: 130 }))
  const from = await pointFromFixture(win, { x: 220, y: 130 })
  const to = { x: from.x + 120, y: from.y + 70 }
  sendMouse(win, 'mouseDown', from)
  await wait(55)
  sendMouse(win, 'mouseMove', { x: from.x + 30, y: from.y + 18 })
  await wait(80)
  snapshot = await bridgeSnapshot(win)
  assert(!snapshot.toolbarVisible, 'toolbar remained visible during body manipulation')
  sendKey(win, 'Escape')
  await wait(100)
  sendMouse(win, 'mouseUp', to)
  await wait(240)
  snapshot = await bridgeSnapshot(win)
  assertPointsEqual(pointsOf(snapshot, IDs.arrow), before, 'Escape body cancellation')
  assert(
    !snapshot.dirty && snapshot.past === 0 && snapshot.future === 0,
    'body cancellation polluted state/history'
  )
  assert(snapshot.toolbarVisible, 'toolbar stayed hidden after body cancellation')

  snapshot = await replaceFixture(win, fixture)
  const bodyBefore = pointsOf(snapshot, IDs.line)
  const bodyStart = await pointFromFixture(win, { x: 220, y: 250 })
  await selectBody(win, bodyStart)
  await pointerDrag(win, bodyStart, { x: bodyStart.x + 70, y: bodyStart.y + 35 })
  snapshot = await bridgeSnapshot(win)
  const bodyAfter = pointsOf(snapshot, IDs.line)
  assert(
    Math.abs(bodyAfter[0] - bodyBefore[0] - 70 / snapshot.zoom) < 5,
    'line body did not translate'
  )
  assert(snapshot.past === 1 && snapshot.future === 0, 'body drag was not one history transaction')
  sendKey(win, 'z', ['cmd'])
  await wait(180)
  snapshot = await bridgeSnapshot(win)
  assertPointsEqual(pointsOf(snapshot, IDs.line), bodyBefore, 'body undo')
  assert(snapshot.future === 1, 'body undo did not create a redo branch')
  sendKey(win, 'z', ['cmd', 'shift'])
  await wait(180)
  snapshot = await bridgeSnapshot(win)
  assertPointsEqual(pointsOf(snapshot, IDs.line), bodyAfter, 'body redo')
  assert(snapshot.past === 1 && snapshot.future === 0, 'body redo did not restore one-step history')

  // Keep an already-dirty document and a real redo branch alive while a second direct gesture
  // is cancelled. This must restore the captured document/history references, not call public
  // undo and accidentally consume or rewrite the user's redo stack.
  sendKey(win, 'z', ['cmd'])
  await wait(180)
  snapshot = await bridgeSnapshot(win)
  assert(snapshot.future === 1 && snapshot.dirty, 'undo did not establish the dirty redo state')
  await selectBody(win, await pointFromFixture(win, { x: 220, y: 250 }))
  const beforeRedoCancel = await bridgeSnapshot(win)
  const redoCancelFrom = await pointFromFixture(win, { x: 220, y: 250 })
  const redoCancelTo = { x: redoCancelFrom.x + 92, y: redoCancelFrom.y + 44 }
  sendMouse(win, 'mouseDown', redoCancelFrom)
  await wait(55)
  sendMouse(win, 'mouseMove', { x: redoCancelFrom.x + 28, y: redoCancelFrom.y + 16 })
  await wait(80)
  const active = await bridgeSnapshot(win)
  assert(!active.toolbarVisible, 'toolbar remained visible during redo-preserving cancellation')
  sendKey(win, 'Escape')
  await wait(100)
  sendMouse(win, 'mouseUp', redoCancelTo)
  await wait(240)
  snapshot = await bridgeSnapshot(win)
  assertPointsEqual(
    pointsOf(snapshot, IDs.line),
    pointsOf(beforeRedoCancel, IDs.line),
    'redo cancellation geometry'
  )
  assert(
    snapshot.dirty === beforeRedoCancel.dirty &&
      snapshot.past === beforeRedoCancel.past &&
      snapshot.future === beforeRedoCancel.future,
    'redo-preserving cancellation changed dirty/history state'
  )
  assert(snapshot.toolbarVisible, 'toolbar stayed hidden after redo-preserving cancellation')
  log('body drag, Escape cancellation, undo/redo, dirty/redo preservation: PASS')
}

function sendKey(win: BrowserWindow, keyCode: string, modifiers: string[] = []): void {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers } as never)
  if (modifiers.length === 0) win.webContents.sendInputEvent({ type: 'char', keyCode } as never)
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers } as never)
}

async function testMultiSelection(win: BrowserWindow, fixture: ClipDocument): Promise<void> {
  let snapshot = await replaceFixture(win, fixture)
  const a = await pointFromFixture(win, { x: 545, y: 175 })
  const b = await pointFromFixture(win, { x: 755, y: 355 })
  await pointerClick(win, a)
  await pointerClick(win, b, ['shift'])
  snapshot = await bridgeSnapshot(win)
  assert(snapshot.selectedIds.length === 2, 'modifier-click did not create a two-object selection')
  assert(
    (await transformerRotateLineVisible(win)) === false,
    'generic Transformer rotate connector line was still visible'
  )
  const historyBeforeClick = snapshot.past
  await pointerClick(win, a)
  snapshot = await bridgeSnapshot(win)
  assert(
    snapshot.selectedIds.length === 1 && snapshot.selectedIds[0] === IDs.rectA,
    'multi-selection click did not collapse'
  )
  assert(snapshot.past === historyBeforeClick, 'selection-only click created document history')

  snapshot = await replaceFixture(win, fixture)
  await pointerClick(win, a)
  await pointerClick(win, b, ['shift'])
  const beforeA = shapeOf(await bridgeSnapshot(win), IDs.rectA) as BoxShape
  const beforeB = shapeOf(await bridgeSnapshot(win), IDs.rectB) as BoxShape
  const dragStart = await pointFromFixture(win, { x: 545, y: 175 })
  await pointerDrag(win, dragStart, { x: dragStart.x + 86, y: dragStart.y + 64 }, async () => {
    const active = await bridgeSnapshot(win)
    assert(!active.toolbarVisible, 'toolbar remained visible during collective drag')
  })
  snapshot = await bridgeSnapshot(win)
  const afterA = shapeOf(snapshot, IDs.rectA) as BoxShape
  const afterB = shapeOf(snapshot, IDs.rectB) as BoxShape
  assert(snapshot.selectedIds.length === 2, 'collective drag collapsed the selection')
  const dxA = afterA.x - beforeA.x
  const dyA = afterA.y - beforeA.y
  assert(Math.abs(dxA - (afterB.x - beforeB.x)) < 0.001, 'multi-selection x deltas diverged')
  assert(Math.abs(dyA - (afterB.y - beforeB.y)) < 0.001, 'multi-selection y deltas diverged')
  assert(
    snapshot.past === 1 && snapshot.future === 0,
    'collective drag was not one history transaction'
  )
  assert(snapshot.toolbarVisible, 'toolbar did not return after collective drag')
  log(`multi-selection click/drag: PASS (common delta ${dxA.toFixed(1)},${dyA.toFixed(1)})`)
}

async function testRotateControl(win: BrowserWindow, fixture: ClipDocument): Promise<void> {
  await replaceFixture(win, fixture)
  await setZoom(win, 1)
  await resetViewportScroll(win)
  await setTool(win, 'select')
  const from = await mappedRecoveryCandidate(win, IDs.rectA, 'rect')
  await selectBody(win, from)
  assert(
    (await transformerRotateLineVisible(win)) === false,
    'generic Transformer rotate connector line was still visible'
  )
  const handle = await rotateHandlePoint(win)
  assert(handle, 'rotate handle was not reachable after selecting a bounded object')
  const center = await pointFromFixture(win, { x: 545, y: 175 })
  const vector = { x: handle.x - center.x, y: handle.y - center.y }
  const radius = Math.max(16, Math.hypot(vector.x, vector.y))
  const angle = Math.atan2(vector.y, vector.x) + Math.PI / 6
  const target = {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius
  }
  const before = await bridgeSnapshot(win)
  await pointerDrag(win, handle, target, async () => {
    const active = await bridgeSnapshot(win)
    assert(!active.toolbarVisible, 'toolbar remained visible during rotate-handle drag')
  })
  const after = await bridgeSnapshot(win)
  const rotation = Number((shapeOf(after, IDs.rectA) as BoxShape).rotation ?? 0)
  const originalRotation = Number((shapeOf(before, IDs.rectA) as BoxShape).rotation ?? 0)
  assert(
    Math.abs(rotation - originalRotation) > 5,
    `rotate handle drag did not change rotation: ${JSON.stringify({
      handle,
      center,
      target,
      before: shapeOf(before, IDs.rectA),
      after: shapeOf(after, IDs.rectA),
      past: after.past,
      toolbarVisible: after.toolbarVisible
    })}`
  )
  assert(after.toolbarVisible, 'toolbar did not return after rotate-handle drag')
  assert(
    (await rotateHandlePoint(win)) !== null,
    'rotate handle was not reachable after the rotation committed'
  )
  log(`rotate handle/connector line: PASS (rotation ${rotation.toFixed(1)}°)`)
}

function fixtureForRecovery(fixture: ClipDocument, id: string): ClipDocument {
  return { ...fixture, shapes: fixture.shapes.filter((shape) => shape.id === id) }
}

function smallExpansionFixture(shape: Shape): ClipDocument {
  const base = fixtureDocument()
  return {
    ...base,
    title: 'ClipThat automatic annotation expansion fixture',
    imageWidth: 160,
    imageHeight: 120,
    crop: { enabled: false, x: 0, y: 0, width: 160, height: 120 },
    canvas: { ...DEFAULT_CANVAS },
    shapes: [shape]
  }
}

function expansionShape(kind: 'arrow' | 'measure' | 'text'): Shape {
  if (kind === 'text') {
    return {
      id: 'expansion-shape',
      type: 'text',
      z: 1,
      x: 48,
      y: 42,
      width: 64,
      height: 28,
      text: 'note',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      fontSize: 18,
      color: '#ffffff',
      background: undefined,
      shadow: false
    }
  }
  return {
    id: 'expansion-shape',
    type: kind,
    z: 1,
    points: kind === 'measure' ? [36, 60, 104, 60] : [36, 42, 104, 42],
    stroke: '#4f8cff',
    strokeWidth: 5,
    endHead: kind === 'arrow',
    curve: kind === 'measure' ? 22 : undefined,
    shadow: false
  }
}

function expectedExpansionSide(
  position: RecoveryPosition
): keyof NonNullable<ClipDocument['canvas']['annotationInsets']> {
  if (position.includes('left')) return 'left'
  if (position.includes('right')) return 'right'
  if (position.startsWith('top')) return 'top'
  return 'bottom'
}

async function exerciseRecoveryCase(
  win: BrowserWindow,
  fixture: ClipDocument,
  zoom: number,
  position: RecoveryPosition,
  id: string,
  type: Shape['type']
): Promise<void> {
  await replaceFixture(win, fixture)
  await setZoom(win, zoom)
  await resetViewportScroll(win)
  await setTool(win, 'select')
  let setup = await bridgeSnapshot(win)
  const from = await mappedRecoveryCandidate(win, id, type)
  const setupStage = setup.stageRect ?? fail('missing Stage bounds during recovery setup')
  const setupViewport = setup.viewportRect ?? fail('missing viewport bounds during recovery setup')
  const safeLeft = Math.max(setupStage.left, setupViewport.left) + 5
  const safeRight =
    Math.min(setupStage.left + setupStage.width, setupViewport.left + setupViewport.width) - 5
  const safeTop = Math.max(setupStage.top, setupViewport.top) + 5
  const safeBottom =
    Math.min(setupStage.top + setupStage.height, setupViewport.top + setupViewport.height) - 5
  assert(
    from.x >= safeLeft && from.x <= safeRight && from.y >= safeTop && from.y <= safeBottom,
    `${id} ${position} ${Math.round(zoom * 100)}% recovery setup point was outside the live ` +
      `Stage/viewport intersection: ${JSON.stringify({
        zoom,
        family: type,
        position,
        stage: setupStage,
        viewport: setupViewport,
        scroll: setup.viewportScroll,
        world: recoveryCandidate(await recoveryRects(win, id), type),
        screen: from,
        safeIntersection: { left: safeLeft, right: safeRight, top: safeTop, bottom: safeBottom }
      })}`
  )
  await selectBody(win, from)
  const before = (setup = await bridgeSnapshot(win))
  const target = outsideTarget(before, position)
  assertTargetOutside(before, target, position)
  await pointerDrag(win, from, target, async () => {
    const active = await bridgeSnapshot(win)
    assert(!active.toolbarVisible, `toolbar remained visible during ${id} recovery drag`)
  })
  let snapshot = await bridgeSnapshot(win)
  assert(
    snapshot.past === before.past + 1 && snapshot.future === 0,
    `${id} ${position} recovery drag was not one history transaction`
  )
  const committedPast = snapshot.past
  assert(snapshot.toolbarVisible, `${id} toolbar did not return after outside release`)
  // Automatic workspace expansion can make the committed corner larger than the pre-drag
  // viewport. Move to the requested live edge before checking the retained painted body.
  await settleViewportForPosition(win, position)
  snapshot = await bridgeSnapshot(win)
  const retainedBeforeDeselect = await retainedRecoveryPoints(win, snapshot, id)
  assert(
    retainedBeforeDeselect.length > 0,
    `${id} had no painted/selectable slice inside the Stage/viewport at ${position}: ${JSON.stringify({ shape: shapeOf(snapshot, id), stage: snapshot.stageRect, viewport: snapshot.viewportRect, recoveryCount: (await recoveryRects(win, id)).length })}`
  )
  // Deselect first so this is a true re-acquisition of the retained painted/hit slice rather
  // than another click on an already-selected draggable node at the canvas edge. Each recovery
  // case has only one annotation, so the opposite-side fixture point is real canvas background.
  const blank = await blankCanvasPoint(win, snapshot)
  await pointerClick(win, blank)
  snapshot = await bridgeSnapshot(win)
  assert(
    snapshot.selectedIds.length === 0,
    `${id} could not deselect before retained-slice click at ${position}: ${JSON.stringify({ blank, shape: shapeOf(snapshot, id), stage: snapshot.stageRect })}`
  )
  await wait(180)
  snapshot = await bridgeSnapshot(win)
  await settleViewportForPosition(win, position)
  snapshot = await bridgeSnapshot(win)
  // A high-zoom overflow viewport may settle its scroll position when the outside release and
  // blank click finish. Re-map the same live recovery geometry after deselection so the click
  // enters at the object's current screen-space location rather than a stale pre-scroll point.
  const retainedCandidates = await retainedRecoveryCandidates(win, snapshot, id)
  assert(
    retainedCandidates.length > 0,
    `${id} lost its painted/selectable slice after deselection at ${position}: ${JSON.stringify({ shape: shapeOf(snapshot, id), stage: snapshot.stageRect, viewport: snapshot.viewportRect })}`
  )
  let candidatesToClick = retainedCandidates
  const viewport = snapshot.viewportRect ?? fail('missing viewport bounds for retained slice')
  const edgeDepth = (point: Point): number => {
    let depth = 0
    if (position.startsWith('top')) depth += point.y - viewport.top
    if (position.startsWith('bottom')) depth += viewport.top + viewport.height - point.y
    if (position.includes('left')) depth += point.x - viewport.left
    if (position.includes('right')) depth += viewport.left + viewport.width - point.x
    return depth
  }
  if (type === 'rect')
    candidatesToClick = [...candidatesToClick].sort(
      (a, b) => edgeDepth(b.screen) - edgeDepth(a.screen)
    )
  if (type === 'line' || type === 'measure') {
    // Prefer the retained sample deepest inside the current viewport rather than a sample near
    // an overflow edge. This still clicks the actual stroke/hit path while avoiding browser
    // edge-autoscroll during the re-acquisition click.
    candidatesToClick = [...retainedCandidates].sort(
      (a, b) => edgeDepth(b.screen) - edgeDepth(a.screen)
    )
  }
  const candidate =
    type === 'measure'
      ? retainedCandidates[Math.floor(retainedCandidates.length / 2)]
      : candidatesToClick[0]
  assert(candidate, `no deterministic retained candidate for ${id}`)
  const retained = await pointFromFixture(win, candidate.world)
  await pointerClick(win, retained)
  snapshot = await bridgeSnapshot(win)
  assert(
    snapshot.selectedIds.length === 1 && snapshot.selectedIds[0] === id,
    `${id} retained interactive slice could not reselect at ${position}: ${JSON.stringify({
      zoom,
      family: type,
      position,
      retained,
      candidate: candidate.world,
      candidates: candidatesToClick.map((item) => item.screen),
      shape: shapeOf(snapshot, id),
      viewport: snapshot.viewportRect,
      scroll: snapshot.viewportScroll,
      stage: snapshot.stageRect,
      selectedIds: snapshot.selectedIds
    })}`
  )
  assert(
    snapshot.past === committedPast,
    `${id} retained-slice click changed history at ${position}: ${JSON.stringify({ beforePast: before.past, past: snapshot.past, retained })}`
  )
}

async function testZoomAndOutsideRelease(win: BrowserWindow, fixture: ClipDocument): Promise<void> {
  const families = [
    { id: IDs.rectA, type: 'rect' as const },
    { id: IDs.line, type: 'line' as const },
    { id: IDs.measure, type: 'measure' as const }
  ]
  for (const zoom of [0.31, 1, 1.25]) {
    for (const family of families) {
      for (const position of RECOVERY_POSITIONS) {
        await exerciseRecoveryCase(
          win,
          fixtureForRecovery(fixture, family.id),
          zoom,
          position,
          family.id,
          family.type
        )
      }
      log(
        `interactive recovery at ${Math.round(zoom * 100)}% for ${family.type}: PASS ` +
          `(8 far-outside releases, painted/hit slice reselected)`
      )
    }
  }

  // Keep a separate explicit leave/release case for the terminal event that motivated the
  // production late-drag fix. The target is outside both the viewport and the Stage.
  let snapshot = await replaceFixture(win, fixtureForRecovery(fixture, IDs.rectA))
  await setZoom(win, 1)
  const start = await mappedRecoveryCandidate(win, IDs.rectA, 'rect')
  await selectBody(win, start)
  snapshot = await bridgeSnapshot(win)
  const stage = snapshot.stageRect ?? fail('missing stage bounds for leave test')
  const outside = {
    x: Math.min(snapshot.windowSize.width - 4, stage.left + stage.width + 96),
    y: Math.min(snapshot.windowSize.height - 4, stage.top + stage.height + 72)
  }
  sendMouse(win, 'mouseDown', start)
  await wait(55)
  sendMouse(win, 'mouseMove', { x: start.x + 30, y: start.y + 20 })
  await wait(80)
  sendMouse(win, 'mouseMove', outside)
  await wait(120)
  sendMouse(win, 'mouseUp', outside)
  await wait(260)
  snapshot = await bridgeSnapshot(win)
  assert(
    snapshot.past === 1 && snapshot.future === 0,
    'late drag-end outside Stage did not commit exactly once'
  )
  assert(snapshot.toolbarVisible, 'toolbar stayed hidden after outside release')
  await settleViewportForPosition(win, 'bottom-right')
  snapshot = await bridgeSnapshot(win)
  const retained = await retainedRecoveryPoint(win, snapshot, IDs.rectA)
  await pointerClick(win, retained)
  assert(
    (await bridgeSnapshot(win)).selectedIds.includes(IDs.rectA),
    'late-release rectangle could not reselect'
  )
  log('Stage leave, far-outside release, and late drag-end: PASS')
}

async function testSaveReopenAndFlatten(win: BrowserWindow, fixture: ClipDocument): Promise<void> {
  let snapshot = await replaceFixture(win, fixture)
  await selectBody(win, await pointFromFixture(win, { x: 220, y: 130 }))
  const start = await pointFromFixture(win, { x: 220, y: 130 })
  await pointerDrag(win, start, { x: start.x + 55, y: start.y + 28 })
  snapshot = await bridgeSnapshot(win)
  const currentDoc = snapshot.doc ?? fail('missing current editor document')
  const project: ClipDocument = {
    ...fixture,
    shapes: currentDoc.shapes,
    updatedAt: Date.now()
  }
  const item = await library.addImage({
    dataUrl: fixture.image,
    title: fixture.title,
    width: fixture.imageWidth,
    height: fixture.imageHeight,
    project
  })
  try {
    const reopened = await library.loadProject(item.id)
    assert(reopened, 'saved editor project could not be reopened')
    assertPointsEqual(
      pointsOf({ ...snapshot, doc: reopened } as EditorSnapshot, IDs.arrow),
      pointsOf(snapshot, IDs.arrow),
      'save/reopen arrow geometry'
    )
    assert(
      openInExistingEditor({ ...reopened, id: fixture.id }),
      'could not reopen saved editor project'
    )
    await wait(320)
    const afterReopen = await waitForBridge(win)
    assertPointsEqual(
      pointsOf(afterReopen, IDs.arrow),
      pointsOf(snapshot, IDs.arrow),
      'reopened editor geometry'
    )

    const reopenedArrow = shapeOf(afterReopen, IDs.arrow) as ArrowShape
    const selectedBeforeRender = await selectBody(
      win,
      await pointFromFixture(win, {
        x: (reopenedArrow.points[0] + reopenedArrow.points[2]) / 2,
        y: (reopenedArrow.points[1] + reopenedArrow.points[3]) / 2
      })
    )
    assert(selectedBeforeRender.selectedIds.includes(IDs.arrow), 'could not select before flatten')

    const selected = await win.webContents.executeJavaScript(
      'window.__CLIPTHAT_EDITOR_SELF_TEST__?.render() ?? null'
    )
    const rendered = selected as { dataUrl: string; selectedIds: string[] } | null
    assert(
      rendered && rendered.dataUrl.startsWith('data:image/'),
      'flatten did not return an image'
    )
    const output = nativeImage.createFromDataURL(rendered.dataUrl)
    const outputSize = output.getSize()
    assert(
      outputSize.width === fixture.imageWidth && outputSize.height === fixture.imageHeight,
      'flatten size changed'
    )
    const afterRender = await bridgeSnapshot(win)
    assert(
      afterRender.toolbarVisible &&
        afterRender.selectedIds.length === selectedBeforeRender.selectedIds.length &&
        afterRender.selectedIds.every((id) => selectedBeforeRender.selectedIds.includes(id)),
      'flatten did not restore editor selection/toolbar'
    )
    log('save/reopen and flatten: PASS')
  } finally {
    await library.remove([item.id])
  }
}

export async function runEditorSelfTest(): Promise<boolean> {
  const fixture = fixtureDocument()
  let win: BrowserWindow | undefined
  try {
    openInEditor(fixture, 'self-test')
    const deadline = Date.now() + 12_000
    while (Date.now() < deadline && !win) {
      win = editorWindows()[0]
      if (!win) await wait(100)
    }
    if (!win) fail('editor window did not open')
    await waitForBridge(win)
    await testCreationAndMeasurementReselection(win, fixture)
    await testEndpointAndCurve(win, fixture)
    await testCancellationAndBody(win, fixture)
    await testMultiSelection(win, fixture)
    await testRotateControl(win, fixture)
    await testZoomAndOutsideRelease(win, fixture)
    await testAutomaticExpansion(win)
    await testSaveReopenAndFlatten(win, fixture)
    log(
      'SUMMARY: PASS (real pointer route, cancellation, history, selection, zoom/edges, persistence, flatten)'
    )
    return true
  } catch (error) {
    console.error(`[selftest] editor: FAIL: ${(error as Error).stack ?? error}`)
    return false
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
  }
}
