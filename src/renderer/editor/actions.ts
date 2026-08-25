import type Konva from 'konva'
import { useCallback } from 'react'
import type { BoxShape, Settings, Shape } from '@shared/types'
import { api } from '../shared/api'
import { toast } from '../shared/ui'
import { runOcr, toImageSpace } from '../shared/ocr'
import { assessOcr, findSensitive, SENSITIVE_LABELS } from '../shared/extract'
import { useEditor } from './store'
import { encodeAs, flatten } from './exporting'

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

  const render = useCallback(async () => {
    if (!(await waitForCutOutImage())) {
      toast('error', 'The Cut Out preview is still rendering')
      return null
    }
    const png = await flatten(stageRef.current)
    if (!png) {
      toast('error', 'Could not render the image')
      return null
    }
    return png
  }, [stageRef])

  /** Flatten, then keep the library copy in sync so the browser never shows a stale thumbnail. */
  const syncLibrary = useCallback(async (dataUrl: string) => {
    const state = useEditor.getState()
    const doc = state.doc
    if (!doc) return
    if (await api.guides.saveEditedStep(doc, dataUrl)) return
    const img = new Image()
    await new Promise((r) => {
      img.onload = r
      img.onerror = r
      img.src = dataUrl
    })
    const item = await api.library.add({
      dataUrl,
      title: doc.title,
      width: img.naturalWidth,
      height: img.naturalHeight,
      project: doc,
      ocrText: doc.ocrText,
      replaceId: state.libraryId ?? undefined
    })
    await api.library.update(
      item.id,
      doc.exportPath ? { title: doc.title, exportPath: doc.exportPath } : { title: doc.title }
    )
    useEditor.setState({ libraryId: item.id })
  }, [])

  const copy = useCallback(async () => {
    const png = await render()
    if (!png) return
    const ok = await api.exports.copyImage(png)
    toast(ok ? 'success' : 'error', ok ? 'Copied to clipboard' : 'Copy failed')
  }, [render])

  const save = useCallback(
    async (saveAs: boolean) => {
      const png = await render()
      if (!png) return
      const state = useEditor.getState()
      const doc = state.doc
      if (!doc) return

      if (await api.editor.guideContext()) {
        await api.guides.saveEditedStep(doc, png)
        useEditor.getState().markSaved()
        toast('success', 'Guide step saved')
        return
      }

      const encoded = await encodeAs(png, format, quality)
      const res = await api.exports.saveImage({
        dataUrl: encoded,
        format,
        suggestedName: doc.title,
        saveAs,
        targetPath: saveAs ? undefined : (state.exportPath ?? undefined)
      })
      if (res.canceled) return
      if (!res.ok) {
        toast('error', 'Save failed', res.error)
        return
      }
      const current = useEditor.getState()
      if (saveAs && res.title) current.setTitle(res.title)
      if (res.filePath) current.setExportPath(res.filePath)
      await syncLibrary(png)
      useEditor.getState().markSaved()
      toast('success', 'Saved', res.filePath)
    },
    [format, quality, render, syncLibrary]
  )

  const exportAs = useCallback(
    async (target: 'png' | 'jpg' | 'webp' | 'pdf' | 'project') => {
      const doc = useEditor.getState().doc
      if (!doc) return

      if (target === 'project') {
        const res = await api.exports.saveProject(doc, true)
        if (res.ok) toast('success', 'Project saved', res.filePath)
        return
      }

      const png = await render()
      if (!png) return

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
        await syncLibrary(png)
        toast('success', `Exported as ${target.toUpperCase()}`, res.filePath)
      } else if (!res.canceled) {
        toast('error', 'Export failed', res.error)
      }
    },
    [quality, render, syncLibrary]
  )

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
    state.setOcrError(null)
    state.setOcrResults(null, null)
    state.setLiveText(false)
    state.setOcrBusy(true)
    try {
      const region = doc.crop.enabled ? doc.crop : undefined
      const result = toImageSpace(await runOcr(doc.image, region), region)
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
      useEditor.getState().setOcrError((err as Error).message || 'The OCR engine did not complete.')
      toast('error', 'Text recognition failed', (err as Error).message)
    } finally {
      useEditor.getState().setOcrBusy(false)
    }
  }, [])

  /**
   * OCR the capture, look for anything that resembles a secret, and drop a blur over
   * each hit. The shapes are ordinary annotations, so every one can be nudged or deleted.
   */
  const autoRedact = useCallback(async () => {
    const state = useEditor.getState()
    const doc = state.doc
    if (!doc) return

    state.setOcrError(null)
    state.setOcrResults(null, null)
    state.setLiveText(false)
    state.setOcrBusy(true)
    try {
      const region = doc.crop.enabled ? doc.crop : undefined
      const raw = await runOcr(doc.image, region)
      const result = toImageSpace(raw, region)
      const assessment = assessOcr(result)
      state.setOcrText(assessment.trusted.text)
      state.setOcrResults(assessment.trusted, result)

      if (assessment.disposition !== 'accepted') {
        toast(
          'info',
          'Auto-blur unavailable',
          'Context text is not fully trusted. Review the capture or raw OCR and blur manually.'
        )
        return
      }

      const matches = findSensitive(assessment.trusted)
      if (matches.length === 0) {
        toast('info', 'Nothing sensitive found')
        return
      }

      state.begin()
      let z = doc.shapes.reduce((m, s) => Math.max(m, s.z), 0)
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
      useEditor.getState().setOcrError((err as Error).message || 'The OCR engine did not complete.')
      toast('error', 'Auto-redact failed', (err as Error).message)
    } finally {
      useEditor.getState().setOcrBusy(false)
    }
  }, [])

  return { copy, save, exportAs, dragOut, grabText, autoRedact, pinToScreen, render, syncLibrary }
}

export type EditorActions = ReturnType<typeof useEditorActions>
