import type Konva from 'konva'
import { useCallback } from 'react'
import type { BoxShape, Settings, Shape } from '@shared/types'
import { api } from '../shared/api'
import { toast } from '../shared/ui'
import { runOcr, toImageSpace } from '../shared/ocr'
import { sameOcrSource } from './ocr-source'
import { assessOcr, findSensitive, SENSITIVE_LABELS } from '../shared/extract'
import { summarizeContextTrust } from '@shared/context-trust'
import { imageFormatForPath } from '@shared/image-format'
import { useEditor } from './store'
import { encodeAs, flatten } from './exporting'
import {
  isSaveDocumentCurrent,
  isSaveRevisionCurrent,
  type EditorSaveSnapshot
} from './save-snapshot'

type StageRef = React.MutableRefObject<Konva.Stage | null>

async function waitForCutOutImage(): Promise<boolean> {
  const started = Date.now()
  while (useEditor.getState().cutOutRendering && Date.now() - started < 5_000) {
    await new Promise((resolve) => setTimeout(resolve, 24))
  }
  return !useEditor.getState().cutOutRendering
}

export function useEditorActions(stageRef: StageRef, settings: Settings | null) {
  const format = settings?.imageFormat ?? 'png'
  const quality = (settings?.jpegQuality ?? 92) / 100

  const output = useCallback(async (label: string, operation: () => Promise<void>) => {
    if (useEditor.getState().outputBusy) return
    useEditor.setState({ outputBusy: label })
    try {
      await operation()
    } catch (error) {
      toast('error', `${label} failed`, (error as Error).message)
    } finally {
      useEditor.setState({ outputBusy: null })
    }
  }, [])

  const render = useCallback(async () => {
    if (!(await waitForCutOutImage())) {
      toast('error', 'The Cut Out preview is still rendering')
      return null
    }
    const current = useEditor.getState()
    const epoch = current.documentEpoch
    const png = await flatten(stageRef.current)
    if (useEditor.getState().documentEpoch !== epoch || useEditor.getState().doc !== current.doc) {
      toast(
        'info',
        'The capture changed while rendering',
        'Run the action again to use the latest edits.'
      )
      return null
    }
    if (!png) {
      toast('error', 'Could not render the image')
      return null
    }
    return png
  }, [stageRef])

  /** Flatten, then keep the library copy in sync so the browser never shows a stale thumbnail. */
  const syncLibrary = useCallback(async (dataUrl: string, source?: EditorSaveSnapshot) => {
    const state = useEditor.getState()
    const doc = source?.doc ?? state.doc
    if (!doc) return null
    const saved = source ?? { doc, libraryId: state.libraryId, epoch: state.documentEpoch }
    if (await api.guides.saveEditedStep(doc, dataUrl)) return doc
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('The rendered capture could not be decoded.'))
      img.src = dataUrl
    })
    const item = await api.library.add({
      dataUrl,
      title: doc.title,
      width: img.naturalWidth,
      height: img.naturalHeight,
      project: doc,
      ocrText: doc.ocrText,
      replaceId: saved.libraryId ?? undefined
    })
    await api.library.update(
      item.id,
      doc.exportPath ? { title: doc.title, exportPath: doc.exportPath } : { title: doc.title }
    )
    if (isSaveDocumentCurrent(useEditor.getState(), saved))
      useEditor.setState({ libraryId: item.id })
    return doc
  }, [])

  const copy = useCallback(async () => {
    const png = await render()
    if (!png) return
    const ok = await api.exports.copyImage(png)
    toast(ok ? 'success' : 'error', ok ? 'Copied to clipboard' : 'Copy failed')
  }, [render])

  const save = useCallback(
    async (saveAs: boolean) => {
      let savedPath: string | undefined
      try {
        const png = await render()
        if (!png) return
        const state = useEditor.getState()
        const doc = state.doc
        if (!doc) return
        const saved: EditorSaveSnapshot = {
          doc,
          libraryId: state.libraryId,
          epoch: state.documentEpoch
        }

        if (await api.editor.guideContext()) {
          await api.guides.saveEditedStep(doc, png)
          useEditor.getState().markSaved(doc)
          toast('success', 'Guide step saved')
          return
        }

        const saveFormat = (!saveAs && imageFormatForPath(state.exportPath)) || format
        const encoded = await encodeAs(png, saveFormat, quality)
        const res = await api.exports.saveImage({
          dataUrl: encoded,
          format: saveFormat,
          suggestedName: doc.title,
          saveAs,
          targetPath: saveAs ? undefined : (state.exportPath ?? undefined)
        })
        if (res.canceled) return
        if (!res.ok) {
          toast('error', 'Save failed', res.error)
          return
        }
        savedPath = res.filePath
        const current = useEditor.getState()
        const sameRevision = isSaveRevisionCurrent(current, saved)
        if (isSaveDocumentCurrent(current, saved)) {
          if (sameRevision && saveAs && res.title) current.setTitle(res.title)
          if (res.filePath) current.setExportPath(res.filePath)
        }
        const cleanCandidate = sameRevision ? useEditor.getState().doc : null
        const savedDoc = {
          ...doc,
          title: saveAs && res.title ? res.title : doc.title,
          exportPath: res.filePath ?? doc.exportPath
        }
        await syncLibrary(png, { ...saved, doc: savedDoc })
        if (cleanCandidate) useEditor.getState().markSaved(cleanCandidate)
        toast(
          'success',
          sameRevision && useEditor.getState().doc === cleanCandidate
            ? 'Saved'
            : 'Saved snapshot; newer edits remain unsaved',
          res.filePath
        )
      } catch (error) {
        toast(
          'error',
          savedPath ? 'Image saved, but Library update failed' : 'Save failed',
          savedPath ? `${savedPath}\n${(error as Error).message}` : (error as Error).message
        )
      }
    },
    [format, quality, render, syncLibrary]
  )

  const exportAs = useCallback(
    async (target: 'png' | 'jpg' | 'webp' | 'pdf' | 'project') => {
      let exportedPath: string | undefined
      try {
        const initial = useEditor.getState()
        const doc = initial.doc
        if (!doc) return
        const saved: EditorSaveSnapshot = {
          doc,
          libraryId: initial.libraryId,
          epoch: initial.documentEpoch
        }

        if (target === 'project') {
          const res = await api.exports.saveProject(doc, true)
          if (res.ok) toast('success', 'Project saved', res.filePath)
          else if (!res.canceled) toast('error', 'Project export failed', res.error)
          return
        }

        const png = await render()
        if (!png) return

        if (!isSaveRevisionCurrent(useEditor.getState(), saved)) {
          toast(
            'info',
            'The capture changed while rendering',
            'Run the export again to use the latest edits.'
          )
          return
        }

        if (target === 'pdf') {
          const res = await api.exports.pdf(png, doc.title)
          if (res.ok) toast('success', 'PDF exported', res.filePath)
          else if (!res.canceled) toast('error', 'PDF export failed', res.error)
          return
        }

        const encoded = await encodeAs(png, target, quality)
        const res = await api.exports.saveImage({
          dataUrl: encoded,
          format: target,
          suggestedName: doc.title,
          saveAs: true
        })
        if (res.ok) {
          exportedPath = res.filePath
          await syncLibrary(png, saved)
          toast('success', `Exported as ${target.toUpperCase()}`, res.filePath)
        } else if (!res.canceled) {
          toast('error', 'Export failed', res.error)
        }
      } catch (error) {
        toast(
          'error',
          exportedPath ? 'Image exported, but Library update failed' : 'Export failed',
          exportedPath ? `${exportedPath}\n${(error as Error).message}` : (error as Error).message
        )
      }
    },
    [quality, render, syncLibrary]
  )

  const print = useCallback(async () => {
    const doc = useEditor.getState().doc
    if (!doc) return
    const png = await render()
    if (!png) return
    const result = await api.exports.print(png, doc.title)
    if (!result.ok && !result.canceled) toast('error', 'Print failed', result.error)
  }, [render])

  const pinToScreen = useCallback(async () => {
    const png = await render()
    if (!png) return
    const ok = await api.pin.create(png)
    toast(ok ? 'success' : 'error', ok ? 'Pinned to screen' : 'Pin failed')
  }, [render])

  const dragOut = useCallback(async () => {
    const png = await render()
    const doc = useEditor.getState().doc
    if (!png || !doc) return
    await api.exports.startDrag(png, doc.title)
  }, [render])

  /* ---------- OCR ---------- */

  const grabText = useCallback(async () => {
    const doc = useEditor.getState().doc
    if (!doc) return
    const state = useEditor.getState()
    if (state.ocrBusy) return
    const epoch = state.documentEpoch
    const isCurrent = () =>
      useEditor.getState().documentEpoch === epoch && sameOcrSource(useEditor.getState().doc, doc)
    state.setOcrError(null)
    state.setOcrResults(null, null)
    state.setLiveText(false)
    state.setOcrBusy(true)
    try {
      const region = doc.crop.enabled ? doc.crop : undefined
      const result = toImageSpace(await runOcr(doc.image, region), region)
      if (!isCurrent()) return
      const assessment = assessOcr(result)
      const text = assessment.trusted.text
      useEditor.getState().setOcrResults(assessment.trusted, result)
      useEditor.getState().setOcrText(text)
      if (text) {
        await navigator.clipboard.writeText(text)
        toast('success', 'Text copied to clipboard', `${text.split(/\s+/).length} words`)
      } else {
        toast('info', 'No meaningful text detected')
      }
    } catch (err) {
      if (!isCurrent()) return
      useEditor.getState().setOcrError((err as Error).message || 'The OCR engine did not complete.')
      toast('error', 'Text recognition failed', (err as Error).message)
    } finally {
      if (useEditor.getState().documentEpoch === epoch) useEditor.getState().setOcrBusy(false)
    }
  }, [])

  /**
   * OCR the capture, look for anything that resembles a secret, and drop a blur over
   * each hit. The shapes are ordinary annotations, so every one can be nudged or deleted.
   */
  const autoRedact = useCallback(async () => {
    const state = useEditor.getState()
    const doc = state.doc
    if (!doc || state.ocrBusy) return
    const epoch = state.documentEpoch
    const isCurrent = () =>
      useEditor.getState().documentEpoch === epoch && sameOcrSource(useEditor.getState().doc, doc)

    state.setOcrError(null)
    state.setOcrResults(null, null)
    state.setLiveText(false)
    state.setOcrBusy(true)
    try {
      const region = doc.crop.enabled ? doc.crop : undefined
      const raw = await runOcr(doc.image, region)
      if (!isCurrent()) return
      const result = toImageSpace(raw, region)
      const assessment = assessOcr(result)
      state.setOcrText(assessment.trusted.text)
      state.setOcrResults(assessment.trusted, result)

      const trust = summarizeContextTrust({
        busy: false,
        assessment,
        raw: result,
        error: null
      })
      if (!trust.structuredActionsAllowed) {
        toast(
          'info',
          'Auto-blur unavailable',
          trust.structuredActionReason ||
            'Context text is not trusted. Review the capture or raw OCR and blur manually.'
        )
        return
      }

      const matches = findSensitive(assessment.trusted)
      if (matches.length === 0) {
        toast('info', 'Nothing sensitive found')
        return
      }

      state.begin()
      let z = useEditor.getState().doc!.shapes.reduce((m, s) => Math.max(m, s.z), 0)
      const pad = 3
      const shapes: BoxShape[] = matches.map((m) => ({
        id: crypto.randomUUID(),
        type: 'blur',
        z: ++z,
        x: m.bbox.x - pad,
        y: m.bbox.y - pad,
        width: m.bbox.width + pad * 2,
        height: m.bbox.height + pad * 2,
        intensity: 22,
        stroke: 'transparent',
        strokeWidth: 0
      }))

      useEditor.setState((s) =>
        s.doc
          ? {
              doc: {
                ...s.doc,
                shapes: [...s.doc.shapes, ...(shapes as Shape[])],
                updatedAt: Date.now()
              },
              selectedIds: shapes.map((s2) => s2.id),
              future: [],
              dirty: true
            }
          : s
      )
      state.end()

      const kinds = [...new Set(matches.map((m) => SENSITIVE_LABELS[m.kind]))].join(', ')
      toast(
        'success',
        `Blurred ${matches.length} sensitive item${matches.length === 1 ? '' : 's'}`,
        kinds
      )
    } catch (err) {
      if (!isCurrent()) return
      useEditor.getState().setOcrError((err as Error).message || 'The OCR engine did not complete.')
      toast('error', 'Auto-redact failed', (err as Error).message)
    } finally {
      if (useEditor.getState().documentEpoch === epoch) useEditor.getState().setOcrBusy(false)
    }
  }, [])

  return {
    copy: () => output('Copying', copy),
    save: (saveAs: boolean) => output('Saving', () => save(saveAs)),
    exportAs: (target: 'png' | 'jpg' | 'webp' | 'pdf' | 'project') =>
      output('Exporting', () => exportAs(target)),
    print: () => output('Printing', print),
    dragOut: () => output('Preparing drag', dragOut),
    grabText,
    autoRedact,
    pinToScreen: () => output('Pinning', pinToScreen),
    render,
    syncLibrary
  }
}

export type EditorActions = ReturnType<typeof useEditorActions>
