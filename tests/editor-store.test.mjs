import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { useEditor } = await load('editorStore')

function document() {
  return {
    version: 1,
    id: 'doc-1',
    title: 'Original',
    createdAt: 1,
    updatedAt: 1,
    image: 'data:image/png;base64,AAAA',
    imageWidth: 100,
    imageHeight: 80,
    scaleFactor: 1,
    crop: { enabled: false, x: 0, y: 0, width: 100, height: 80 },
    shapes: [],
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

test('title edits are one explicit undo transaction', () => {
  const state = useEditor.getState()
  state.setDoc(document())
  state.begin()
  assert.equal(useEditor.getState().dirty, false)
  state.setTitle('First edit')
  state.setTitle('Finished title')
  assert.equal(useEditor.getState().past.length, 1)
  assert.equal(useEditor.getState().dirty, true)

  useEditor.getState().undo()
  assert.equal(useEditor.getState().doc.title, 'Original')
  useEditor.getState().redo()
  assert.equal(useEditor.getState().doc.title, 'Finished title')
})

test('continuous canvas changes undo to the value at transaction start', () => {
  const state = useEditor.getState()
  state.setDoc(document())
  state.begin()
  state.setCanvas({ padding: 20 })
  state.setCanvas({ padding: 40 })
  state.setCanvas({ padding: 60 })
  assert.equal(useEditor.getState().past.length, 1)
  assert.equal(useEditor.getState().doc.canvas.padding, 60)

  useEditor.getState().undo()
  assert.equal(useEditor.getState().doc.canvas.padding, 0)
})

test('a transaction with no mutation does not create a no-op undo entry', () => {
  const state = useEditor.getState()
  state.setDoc(document())
  state.begin()
  state.end()
  assert.equal(useEditor.getState().past.length, 0)
  assert.equal(useEditor.getState().dirty, false)
})

test('a new explicit transaction after undo invalidates the redo branch', () => {
  let state = useEditor.getState()
  state.setDoc(document())
  state.begin()
  state.setTitle('Discarded branch')
  state.end()
  state.undo()
  assert.equal(useEditor.getState().future.length, 1)

  state = useEditor.getState()
  state.begin()
  state.setCanvas({ padding: 48 })
  state.end()
  assert.equal(useEditor.getState().future.length, 0)

  useEditor.getState().redo()
  assert.equal(useEditor.getState().doc.title, 'Original')
  assert.equal(useEditor.getState().doc.canvas.padding, 48)
})

test('opening another document returns the canvas to fit-to-window mode', () => {
  let state = useEditor.getState()
  state.setDoc(document())
  state.setZoom(2, false)

  state = useEditor.getState()
  state.setDoc({ ...document(), id: 'doc-2' })

  assert.equal(useEditor.getState().zoom, 1)
  assert.equal(useEditor.getState().autoFit, true)
})

test('keeps the external still path with the active Library document', () => {
  const state = useEditor.getState()
  state.setDoc({ ...document(), exportPath: '/tmp/first.png' }, 'library-1')
  assert.equal(useEditor.getState().exportPath, '/tmp/first.png')

  useEditor.getState().setExportPath('/tmp/renamed.png')
  assert.equal(useEditor.getState().exportPath, '/tmp/renamed.png')
  assert.equal(useEditor.getState().doc.exportPath, '/tmp/renamed.png')
})
