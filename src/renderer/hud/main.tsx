import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/theme.css'
import { api } from '../shared/api'
import Recorder from './Recorder'
import ScrollHud from './ScrollHud'
import Pin from './Pin'
import QuickAccess from './QuickAccess'

/**
 * Invisible OCR worker. The main process has no DOM and no WASM host, so text
 * recognition for the global "Grab text" hotkey is serviced here.
 */
function OcrWorker(): React.ReactElement {
  useEffect(
    () =>
      api.ocr.onRequest(async ({ id, dataUrl, rect }) => {
        try {
          const { runOcr } = await import('../shared/ocr')
          const result = await runOcr(dataUrl, rect as never)
          api.ocr.respond(id, result.text)
        } catch {
          api.ocr.respond(id, '')
        }
      }),
    []
  )
  return <div />
}

const mode = window.location.hash.replace('#', '')

const roots: Record<string, React.ReactElement> = {
  worker: <OcrWorker />,
  scroll: <ScrollHud />,
  pin: <Pin />,
  quick: <QuickAccess />
}

createRoot(document.getElementById('root')!).render(roots[mode] ?? <Recorder />)
