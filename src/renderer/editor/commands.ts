import type { Command } from '../shared/CommandPalette'
import { api } from '../shared/api'
import { BEAUTIFY_CANVAS, DEFAULT_CANVAS } from '@shared/defaults'
import { useEditor } from './store'
import { TOOLS } from './panels/Toolbar'
import type { EditorActions } from './actions'

const mod = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'

export interface AnnotationClipboardActions {
  copy: () => void | Promise<unknown>
  paste: () => void | Promise<unknown>
}

/** Everything the editor can do, in one searchable list. */
export function editorCommands(
  actions: EditorActions,
  annotationClipboard: AnnotationClipboardActions
): Command[] {
  const state = () => useEditor.getState()
  const hasSelection = () => state().selectedIds.length > 0

  const tools: Command[] = TOOLS.flat().map((t) => ({
    id: `tool.${t.id}`,
    title: t.label,
    group: 'Tools',
    icon: t.icon,
    shortcut: t.key,
    keywords: 'tool draw',
    run: () => state().setTool(t.id)
  }))

  return [
    ...tools,

    {
      id: 'capture.region',
      title: 'New region capture',
      group: 'Capture',
      icon: 'region',
      keywords: 'screenshot snip new',
      run: () => void api.capture.start({ mode: 'region' })
    },
    {
      id: 'capture.window',
      title: 'New window capture',
      group: 'Capture',
      icon: 'window',
      run: () => void api.capture.start({ mode: 'window' })
    },
    {
      id: 'capture.screen',
      title: 'New screen capture',
      group: 'Capture',
      icon: 'monitor',
      run: () => void api.capture.start({ mode: 'display' })
    },
    {
      id: 'capture.scrolling',
      title: 'Scrolling capture',
      group: 'Capture',
      icon: 'scroll',
      keywords: 'long page stitch',
      run: () => void api.capture.start({ mode: 'scrolling' })
    },
    {
      id: 'capture.clipboard',
      title: 'Open image from clipboard',
      group: 'Capture',
      icon: 'clipboard',
      keywords: 'paste',
      run: () => void api.capture.fromClipboard()
    },
    {
      id: 'capture.record',
      title: 'Record screen',
      group: 'Capture',
      icon: 'record',
      keywords: 'video mp4 gif',
      run: () => api.system.window('record')
    },

    {
      id: 'context.open',
      title: 'Screen context',
      hint: 'read text, links, tables and colours',
      group: 'Context',
      icon: 'sparkles',
      keywords: 'ocr extract analyse understand',
      run: () => state().setPanel('context')
    },
    {
      id: 'context.livetext',
      title: 'Toggle Live Text',
      hint: 'select words directly on the capture',
      group: 'Context',
      icon: 'type',
      keywords: 'ocr select copy',
      run: () => {
        state().setPanel('context')
        state().setLiveText(!state().liveTextOn)
      }
    },
    {
      id: 'context.grabtext',
      title: 'Copy all text in this capture',
      group: 'Context',
      icon: 'type',
      keywords: 'ocr grab',
      run: () => void actions.grabText()
    },
    {
      id: 'context.redact',
      title: 'Blur sensitive data',
      hint: 'emails, keys, card numbers',
      group: 'Context',
      icon: 'shield',
      keywords: 'redact privacy hide secret',
      run: () => void actions.autoRedact()
    },

    {
      id: 'canvas.beautify',
      title: 'Beautify',
      hint: 'padding, gradient, shadow',
      group: 'Canvas',
      icon: 'sparkles',
      run: () => {
        state().begin()
        state().setCanvas(BEAUTIFY_CANVAS)
        state().end()
        state().setPanel('inspect')
      }
    },
    {
      id: 'canvas.plain',
      title: 'Remove canvas styling',
      group: 'Canvas',
      icon: 'refresh',
      run: () => {
        state().begin()
        state().setCanvas(DEFAULT_CANVAS)
        state().end()
      }
    },
    ...(['macos', 'windows', 'none'] as const).map((frame) => ({
      id: `canvas.frame.${frame}`,
      title:
        frame === 'none'
          ? 'Remove window frame'
          : `Add ${frame === 'macos' ? 'macOS' : 'Windows'} window frame`,
      group: 'Canvas',
      icon: 'frame' as const,
      run: () => {
        state().begin()
        state().setCanvas({ frame })
        state().end()
      }
    })),

    {
      id: 'edit.undo',
      title: 'Undo',
      group: 'Edit',
      icon: 'undo',
      shortcut: `${mod}Z`,
      run: () => state().undo(),
      disabled: false
    },
    {
      id: 'edit.redo',
      title: 'Redo',
      group: 'Edit',
      icon: 'redo',
      shortcut: `⇧${mod}Z`,
      run: () => state().redo()
    },
    {
      id: 'edit.duplicate',
      title: 'Duplicate selection',
      group: 'Edit',
      icon: 'copy',
      shortcut: `${mod}D`,
      run: () => state().duplicateSelected(),
      disabled: !hasSelection()
    },
    {
      id: 'edit.copyAnnotations',
      title: 'Copy selected annotations',
      group: 'Edit',
      icon: 'copy',
      shortcut: `${mod}C`,
      keywords: 'clipboard shapes markup',
      run: () => void annotationClipboard.copy(),
      disabled: !hasSelection()
    },
    {
      id: 'edit.pasteAnnotations',
      title: 'Paste annotations',
      group: 'Edit',
      icon: 'clipboard',
      shortcut: `${mod}V`,
      keywords: 'clipboard shapes markup',
      run: () => void annotationClipboard.paste()
    },
    {
      id: 'edit.delete',
      title: 'Delete selection',
      group: 'Edit',
      icon: 'trash',
      shortcut: '⌫',
      run: () => state().removeShapes(state().selectedIds),
      disabled: !hasSelection()
    },
    {
      id: 'edit.selectAll',
      title: 'Select all annotations',
      group: 'Edit',
      icon: 'layers',
      shortcut: `${mod}A`,
      run: () => {
        const doc = state().doc
        if (doc) state().select(doc.shapes.map((s) => s.id))
      }
    },
    {
      id: 'edit.uncrop',
      title: 'Undo crop',
      group: 'Edit',
      icon: 'crop',
      run: () => state().resetCrop(),
      disabled: !state().doc?.crop.enabled
    },

    {
      id: 'export.copy',
      title: 'Copy image to clipboard',
      group: 'Export',
      icon: 'copy',
      run: () => void actions.copy()
    },
    {
      id: 'export.save',
      title: 'Save',
      group: 'Export',
      icon: 'download',
      shortcut: `${mod}S`,
      run: () => void actions.save(false)
    },
    {
      id: 'export.saveAs',
      title: 'Save as…',
      group: 'Export',
      icon: 'save',
      shortcut: `⇧${mod}S`,
      run: () => void actions.save(true)
    },
    ...(['png', 'jpg', 'webp', 'pdf'] as const).map((format) => ({
      id: `export.${format}`,
      title: `Export as ${format.toUpperCase()}`,
      group: 'Export',
      icon: 'download' as const,
      run: () => void actions.exportAs(format)
    })),
    {
      id: 'export.pin',
      title: 'Pin to screen',
      hint: 'float this capture above every window',
      group: 'Export',
      icon: 'lock',
      keywords: 'float always on top reference',
      run: () => void actions.pinToScreen()
    },
    {
      id: 'export.project',
      title: 'Export editable project (.clipthat)',
      group: 'Export',
      icon: 'layers',
      run: () => void actions.exportAs('project')
    },

    {
      id: 'view.fit',
      title: 'Fit to window',
      group: 'View',
      icon: 'fit',
      shortcut: `${mod}0`,
      run: () => state().setZoom(1, true)
    },
    {
      id: 'view.actual',
      title: 'Zoom to 100%',
      group: 'View',
      icon: 'zoomIn',
      run: () => state().setZoom(1, false)
    },
    {
      id: 'view.layers',
      title: 'Show layers',
      group: 'View',
      icon: 'layers',
      run: () => state().setPanel('layers')
    },
    {
      id: 'view.style',
      title: 'Show style panel',
      group: 'View',
      icon: 'settings',
      run: () => state().setPanel('inspect')
    },
    {
      id: 'app.library',
      title: 'Open library',
      group: 'App',
      icon: 'grid',
      run: () => api.system.window('library')
    },
    {
      id: 'app.settings',
      title: 'Open settings',
      group: 'App',
      icon: 'settings',
      run: () => api.system.window('settings')
    }
  ]
}
