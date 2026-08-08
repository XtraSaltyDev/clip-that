import React, { useEffect, useMemo, useRef, useState } from 'react'
import type Konva from 'konva'
import type { LibraryItem } from '@shared/types'
import { ToastHost, useHotkeys, useImage, useSize, useTheme, toast } from '../shared/ui'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import { useEditor } from './store'
import { useEditorActions } from './actions'
import EditorStage from './canvas/Stage'
import Toolbar, { TOOL_KEYS } from './panels/Toolbar'
import TopBar from './panels/TopBar'
import Sidebar from './panels/Sidebar'
import LibraryStrip from './panels/LibraryStrip'
import CommandPalette from '../shared/CommandPalette'
import { editorCommands } from './commands'
import { orderWords, selectedText } from './canvas/LiveText'
import './editor.css'

export default function App(): React.ReactElement {
  const settings = useTheme()
  const doc = useEditor((s) => s.doc)
  const zoom = useEditor((s) => s.zoom)
  const libraryId = useEditor((s) => s.libraryId)
  const setDoc = useEditor((s) => s.setDoc)
  const image = useImage(doc?.image)
  const stageRef = useRef<Konva.Stage | null>(null)
  const [viewportRef, viewport] = useSize<HTMLDivElement>()
  const actions = useEditorActions(stageRef, settings)
  const [dropping, setDropping] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [openingLibraryId, setOpeningLibraryId] = useState<string | null>(null)
  const closeSaving = useRef(false)
  // Rebuilt when the palette opens so disabled states reflect the current selection.
  const commands = useMemo(() => editorCommands(actions), [actions, paletteOpen])

  /* ---------- document loading ---------- */

  useEffect(() => {
    let alive = true
    void api.editor.load().then((loaded) => {
      if (alive && loaded) setDoc(loaded, loaded.id)
    })
    const off = api.editor.onDocument((incoming) => {
      void (async () => {
        const current = useEditor.getState()
        if (current.doc && current.doc.id !== incoming.id && current.dirty) {
          try {
            const rendered = await actions.render()
            if (!rendered) return
            await actions.syncLibrary(rendered)
            useEditor.getState().markSaved()
          } catch (error) {
            toast('error', 'Could not save the current Library item', (error as Error).message)
            return
          }
        }
        if (alive) setDoc(incoming, incoming.id)
      })()
    })
    return () => {
      alive = false
      off()
    }
  }, [actions.render, actions.syncLibrary, setDoc])

  /* ---------- dirty-close interception ---------- */

  useEffect(() => {
    const off = api.editor.onCloseRequested(() => {
      if (closeSaving.current) return
      closeSaving.current = true
      void (async () => {
        try {
          const current = useEditor.getState()
          if (current.dirty) {
            const rendered = await actions.render()
            if (!rendered) throw new Error('The edited image could not be rendered')
            await actions.syncLibrary(rendered)
            useEditor.getState().markSaved()
          }
          await api.editor.confirmClose(true)
        } catch (error) {
          toast('error', 'Could not save changes before closing', (error as Error).message)
          await api.editor.confirmClose(false)
        } finally {
          closeSaving.current = false
        }
      })()
    })
    void api.editor.closeReady()
    return off
  }, [actions.render, actions.syncLibrary])

  useEffect(() => {
    void api.library.health().then((health) => {
      if (health.status !== 'ok') {
        toast(health.status === 'error' ? 'error' : 'info', health.message, health.detail)
      }
    })
    return api.library.onIssue((health) => {
      if (health.status !== 'ok') {
        toast(health.status === 'error' ? 'error' : 'info', health.message, health.detail)
      }
    })
  }, [])

  /* ---------- seed tool defaults from settings ---------- */

  useEffect(() => {
    if (!settings) return
    useEditor.getState().setStyle({
      color: settings.defaultAnnotationColor,
      fill: settings.defaultAnnotationColor,
      strokeWidth: settings.defaultStrokeWidth,
      fontSize: settings.defaultFontSize,
      fontFamily: settings.defaultFontFamily
    })
  }, [settings])

  /* ---------- keyboard ---------- */

  // Always live, so ⌘K toggles the palette shut as well as open.
  useHotkeys({ 'mod+k': () => setPaletteOpen((o) => !o) })

  useHotkeys(
    {
      'mod+z': () => useEditor.getState().undo(),
      'mod+shift+z': () => useEditor.getState().redo(),
      'mod+y': () => useEditor.getState().redo(),
      'mod+c': () => {
        // With Live Text active, ⌘C means "copy the words I selected", not the picture.
        const s = useEditor.getState()
        if (s.liveTextOn && s.liveSelection && s.ocr) {
          const text = selectedText(orderWords(s.ocr.words), s.liveSelection)
          if (text) {
            void navigator.clipboard.writeText(text)
            toast('success', 'Text copied', `${text.split(/\s+/).length} words`)
            return
          }
        }
        void actions.copy()
      },
      'mod+s': () => void actions.save(false),
      'mod+shift+s': () => void actions.save(true),
      'mod+e': () => void actions.exportAs('png'),
      'mod+d': () => useEditor.getState().duplicateSelected(),
      'mod+a': () => {
        const d = useEditor.getState().doc
        if (d) useEditor.getState().select(d.shapes.map((s) => s.id))
      },
      'mod+0': () => useEditor.getState().setZoom(1, true),
      'mod+=': () => useEditor.getState().setZoom(useEditor.getState().zoom * 1.25),
      'mod+-': () => useEditor.getState().setZoom(useEditor.getState().zoom / 1.25),
      delete: () => useEditor.getState().removeShapes(useEditor.getState().selectedIds),
      backspace: () => useEditor.getState().removeShapes(useEditor.getState().selectedIds),
      escape: () => {
        const s = useEditor.getState()
        if (s.liveSelection) s.setLiveSelection(null)
        else if (s.editingTextId) s.setEditingText(null)
        else if (s.tool !== 'select') s.setTool('select')
        else s.select([])
      },
      enter: () => {
        const s = useEditor.getState()
        if (s.tool === 'crop' && s.cropDraft && s.cropDraft.width > 4) s.applyCrop(s.cropDraft)
      },
      arrowup: (e) => nudge(0, e.shiftKey ? -10 : -1),
      arrowdown: (e) => nudge(0, e.shiftKey ? 10 : 1),
      arrowleft: (e) => nudge(e.shiftKey ? -10 : -1, 0),
      arrowright: (e) => nudge(e.shiftKey ? 10 : 1, 0),
      ...Object.fromEntries(
        Object.entries(TOOL_KEYS).map(([key, tool]) => [
          key,
          () => useEditor.getState().setTool(tool)
        ])
      )
    },
    !paletteOpen
  )

  /* ---------- wheel zoom ---------- */

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const next = useEditor.getState().zoom * (e.deltaY > 0 ? 0.94 : 1.06)
      useEditor.getState().setZoom(next, false)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [viewportRef])

  /* ---------- drag & drop images ---------- */

  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault()
      setDropping(true)
    }
    const leave = () => setDropping(false)
    const drop = async (e: DragEvent) => {
      e.preventDefault()
      setDropping(false)
      const file = e.dataTransfer?.files?.[0]
      if (!file || !/^image\//.test(file.type)) return
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.readAsDataURL(file)
      })
      const img = new Image()
      img.onload = () => {
        setDoc({
          version: 1,
          id: crypto.randomUUID(),
          title: file.name.replace(/\.[^.]+$/, ''),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          image: dataUrl,
          imageWidth: img.naturalWidth,
          imageHeight: img.naturalHeight,
          scaleFactor: 1,
          crop: { enabled: false, x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight },
          shapes: [],
          canvas: settings?.canvasPreset ?? useEditor.getState().doc!.canvas
        })
        toast('success', 'Opened ' + file.name)
      }
      img.src = dataUrl
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [setDoc, settings])

  const openLibraryItem = async (item: LibraryItem): Promise<void> => {
    if (openingLibraryId || item.id === useEditor.getState().libraryId) return
    setOpeningLibraryId(item.id)
    try {
      if (item.kind === 'video') {
        await api.library.open(item.id)
        return
      }

      const current = useEditor.getState()
      if (current.dirty) {
        const rendered = await actions.render()
        if (!rendered) return
        await actions.syncLibrary(rendered)
        useEditor.getState().markSaved()
      }

      const opened = await api.editor.switchLibraryItem(item.id)
      if (!opened) toast('error', 'Could not open that Library item')
    } catch (error) {
      toast('error', 'Could not open that Library item', (error as Error).message)
    } finally {
      setOpeningLibraryId(null)
    }
  }

  return (
    <div className="editor-shell">
      <TopBar actions={actions} onOpenPalette={() => setPaletteOpen(true)} />
      <div className="editor-body">
        <Toolbar />
        <main className="viewport" ref={viewportRef}>
          {doc && image ? (
            <div className="viewport-inner">
              <div className="checker" style={{ transform: `scale(1)` }}>
                <EditorStage
                  image={image}
                  containerWidth={viewport.width}
                  containerHeight={viewport.height}
                  stageRef={stageRef}
                />
              </div>
            </div>
          ) : (
            <div className="empty">
              <Icon name="image" size={34} />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--ink-1)' }}>Nothing loaded</div>
                <div className="tiny">Take a capture, or drop an image here.</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" onClick={() => void api.capture.start({ mode: 'region' })}>
                  <Icon name="region" size={14} /> Capture region
                </button>
                <button className="btn ghost" onClick={() => void api.capture.fromClipboard()}>
                  <Icon name="clipboard" size={14} /> Paste
                </button>
              </div>
            </div>
          )}
          {dropping && (
            <div className="drop-veil">
              <Icon name="image" size={30} />
              Drop an image to edit it
            </div>
          )}
        </main>
        <Sidebar image={image} />
        <LibraryStrip
          activeId={libraryId}
          openingId={openingLibraryId}
          onOpen={(item) => void openLibraryItem(item)}
        />
      </div>
      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
        placeholder="Search tools, capture modes, exports…"
      />
      <ToastHost />
    </div>
  )
}

function nudge(dx: number, dy: number): void {
  const state = useEditor.getState()
  const doc = state.doc
  if (!doc || state.selectedIds.length === 0) return
  const ids = new Set(state.selectedIds)
  state.begin()
  const patch: Record<string, Partial<import('@shared/types').Shape>> = {}
  for (const shape of doc.shapes) {
    if (!ids.has(shape.id)) continue
    if ('points' in shape) {
      patch[shape.id] = {
        points: shape.points.map((p, i) => (i % 2 === 0 ? p + dx : p + dy))
      } as Partial<import('@shared/types').Shape>
    } else if ('x' in shape) {
      patch[shape.id] = { x: shape.x + dx, y: shape.y + dy } as Partial<
        import('@shared/types').Shape
      >
    }
  }
  state.updateShapes(patch)
  state.end()
}
