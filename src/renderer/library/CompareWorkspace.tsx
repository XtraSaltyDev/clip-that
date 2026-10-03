import React, { useEffect, useRef, useState } from 'react'
import type { LibraryItem } from '@shared/types'
import type { ImageComparison } from '@shared/image-compare'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import { Segmented, toast } from '../shared/ui'
import { useDebouncedValue } from '../shared/preferences'
import {
  comparisonReport,
  drawComparison,
  loadComparison,
  type ComparisonFrames,
  type ComparisonMode
} from './compare-images'
import './compare.css'

export default function CompareWorkspace({
  items,
  onBack
}: {
  items: [LibraryItem, LibraryItem]
  onBack: () => void
}): React.ReactElement {
  const [swapped, setSwapped] = useState(false)
  const before = items[swapped ? 1 : 0]
  const after = items[swapped ? 0 : 1]
  const [frames, setFrames] = useState<ComparisonFrames | null>(null)
  const [result, setResult] = useState<ImageComparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [mode, setMode] = useState<ComparisonMode>('wipe')
  const [amount, setAmount] = useState(50)
  const [threshold, setThreshold] = useState(16)
  const tolerance = useDebouncedValue(threshold, 150)
  const [region, setRegion] = useState(-1)
  const [actualSize, setActualSize] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [loadBusy, setLoadBusy] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)

  useEffect(() => backRef.current?.focus(), [])

  useEffect(() => {
    const controller = new AbortController()
    setFrames(null)
    setResult(null)
    setError(null)
    setRegion(-1)
    setLoadBusy(true)
    void loadComparison(before, after, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setFrames(next)
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError((failure as Error).message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadBusy(false)
      })
    return () => controller.abort()
  }, [before, after, retry])

  useEffect(() => {
    if (!frames) return
    setResult(null)
    setRegion(-1)
    setError(null)
    let worker: Worker
    try {
      worker = new Worker(new URL('./compare.worker.ts', import.meta.url), { type: 'module' })
    } catch (failure) {
      setError(`The comparison worker could not start. ${(failure as Error).message}`)
      return
    }
    worker.onmessage = (event: MessageEvent<{ result?: ImageComparison; error?: string }>) => {
      clearTimeout(timeout)
      if (event.data.error) setError(event.data.error)
      else if (event.data.result) setResult(event.data.result)
      worker.terminate()
    }
    worker.onerror = () => {
      clearTimeout(timeout)
      setError('The comparison could not finish. Retry to reload both captures.')
      worker.terminate()
    }
    const timeout = setTimeout(() => {
      setError('Comparison took too long. Retry to start again.')
      worker.terminate()
    }, 20_000)
    try {
      const first = frames.before
        .getContext('2d')!
        .getImageData(0, 0, frames.width, frames.height).data
      const second = frames.after
        .getContext('2d')!
        .getImageData(0, 0, frames.width, frames.height).data
      worker.postMessage(
        {
          before: first,
          after: second,
          width: frames.width,
          height: frames.height,
          threshold: tolerance
        },
        [first.buffer, second.buffer]
      )
    } catch (failure) {
      clearTimeout(timeout)
      worker.terminate()
      setError(`The capture pixels could not be read. ${(failure as Error).message}`)
    }
    return () => {
      clearTimeout(timeout)
      worker.terminate()
    }
  }, [frames, tolerance])

  useEffect(() => {
    if (frames && canvasRef.current)
      drawComparison(canvasRef.current, frames, mode, amount, result, region)
  }, [frames, mode, amount, result, region])

  const exportReport = async (copy: boolean) => {
    if (!frames || !result || threshold !== tolerance || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const png = comparisonReport(frames, result, before, after, mode, amount, tolerance)
      if (copy) {
        const ok = await api.exports.copyImage(png)
        if (!ok) throw new Error('The clipboard could not be updated.')
        toast('success', 'Comparison copied')
      } else {
        const saved = await api.exports.saveImage({
          dataUrl: png,
          format: 'png',
          suggestedName: `${after.title.slice(0, 180)} comparison`,
          saveAs: true
        })
        if (saved.canceled) return
        if (!saved.ok) throw new Error(saved.error || 'Choose another destination and try again.')
        toast('success', 'Comparison exported', saved.filePath)
      }
    } catch (failure) {
      toast('error', 'Could not export the comparison', (failure as Error).message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const busy = loadBusy || Boolean(frames && !result && !error) || tolerance !== threshold
  const sizedDifferently =
    frames &&
    (frames.beforeSize.width !== frames.afterSize.width ||
      frames.beforeSize.height !== frames.afterSize.height)

  return (
    <div className="compare-workspace">
      <header className="compare-top drag-region">
        <button ref={backRef} className="btn ghost no-drag" onClick={onBack}>
          <Icon name="chevronLeft" size={14} /> Library
        </button>
        <strong>Compare captures</strong>
        <span className="compare-local tiny">Offline · originals preserved</span>
        <div className="spacer" />
        <button
          className="btn no-drag"
          disabled={!result || busy || saving}
          onClick={() => void exportReport(true)}
        >
          <Icon name="copy" size={14} /> Copy
        </button>
        <button
          className="btn primary no-drag"
          disabled={!result || busy || saving}
          onClick={() => void exportReport(false)}
        >
          <Icon name="download" size={14} /> {saving ? 'Exporting…' : 'Export PNG'}
        </button>
      </header>
      <div className="compare-controls">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'wipe', label: 'Wipe' },
            { value: 'overlay', label: 'Overlay' },
            { value: 'difference', label: 'Difference', disabled: !result },
            { value: 'before', label: 'Before' },
            { value: 'after', label: 'After' }
          ]}
        />
        <div className="spacer" />
        <button
          className="btn ghost"
          disabled={saving}
          onClick={() => setSwapped((value) => !value)}
        >
          <Icon name="refresh" size={14} /> Swap
        </button>
        <button
          className="btn"
          aria-pressed={actualSize}
          onClick={() => setActualSize((value) => !value)}
        >
          <Icon name="fit" size={14} /> {actualSize ? 'Fit to window' : 'Analysis pixels (100%)'}
        </button>
      </div>
      <div className="compare-layout">
        <main className="compare-main">
          <div className="compare-labels">
            <div>
              <span>Before</span>
              <strong className="truncate" title={before.title}>
                {before.title}
              </strong>
              <small>
                {frames
                  ? `${frames.beforeSize.width}×${frames.beforeSize.height}`
                  : `${before.width}×${before.height}`}
              </small>
            </div>
            <div>
              <span>After</span>
              <strong className="truncate" title={after.title}>
                {after.title}
              </strong>
              <small>
                {frames
                  ? `${frames.afterSize.width}×${frames.afterSize.height}`
                  : `${after.width}×${after.height}`}
              </small>
            </div>
          </div>
          <div className={`compare-stage ${actualSize ? 'actual' : ''}`} aria-busy={busy}>
            {frames ? (
              <canvas
                ref={canvasRef}
                aria-label={`${mode} comparison of ${before.title} and ${after.title}`}
                onPointerDown={(event) => {
                  if (mode !== 'wipe') return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  const box = event.currentTarget.getBoundingClientRect()
                  setAmount(
                    Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100))
                  )
                }}
                onPointerMove={(event) => {
                  if (mode !== 'wipe' || !event.currentTarget.hasPointerCapture(event.pointerId))
                    return
                  const box = event.currentTarget.getBoundingClientRect()
                  setAmount(
                    Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100))
                  )
                }}
              />
            ) : (
              <div className="empty">
                <Icon name="image" size={30} />
                <span>{loadBusy ? 'Loading both captures…' : 'Preview unavailable'}</span>
              </div>
            )}
          </div>
          {(mode === 'wipe' || mode === 'overlay') && (
            <label className="compare-slider">
              <span>{mode === 'wipe' ? 'Wipe position' : 'Before opacity'}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={amount}
                onChange={(event) => setAmount(Number(event.target.value))}
              />
              <output>{Math.round(amount)}%</output>
            </label>
          )}
          <p className="compare-note">
            {sizedDifferently
              ? 'Different dimensions: captures are aligned at the top left without stretching. '
              : ''}
            {frames?.scale && frames.scale < 1
              ? `Large captures use a ${frames.width}×${frames.height} analysis preview; small changes can be lost at this scale.`
              : 'Changes are measured at native pixel resolution.'}
          </p>
        </main>
        <aside className="compare-summary" aria-label="Comparison findings">
          <div className="compare-summary-head">
            <Icon name="sparkles" size={16} />
            <strong>What changed</strong>
          </div>
          {error ? (
            <div role="alert" className="compare-error">
              <p>{error}</p>
              <button className="btn" onClick={() => setRetry((value) => value + 1)}>
                Retry comparison
              </button>
            </div>
          ) : (
            <div role="status" aria-live="polite">
              <div className="compare-percent">
                {busy ? '…' : result ? `${result.changedPercent.toFixed(2)}%` : '—'}
              </div>
              <p className="tiny muted">
                {busy
                  ? 'Comparing pixels locally…'
                  : result?.changedPixels
                    ? `${result.changedPixels.toLocaleString()} changed analysis pixels`
                    : 'No pixel changes above this tolerance'}
              </p>
            </div>
          )}
          <label className="compare-tolerance">
            <span>
              Change tolerance <output>{threshold}</output>
            </span>
            <input
              type="range"
              min={0}
              max={96}
              value={threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
            <small>Lower finds subtle changes. Higher ignores small colour differences.</small>
          </label>
          {result && !busy && (
            <>
              <div className="compare-region-head">
                <strong>
                  {result.regions.length} change region{result.regions.length === 1 ? '' : 's'}
                </strong>
                {region >= 0 && (
                  <button className="btn ghost sm" onClick={() => setRegion(-1)}>
                    Clear
                  </button>
                )}
              </div>
              <p className="tiny muted">
                Nearby changed pixels are grouped. Select a region to outline it.
              </p>
              <ol className="compare-regions">
                {result.regions.slice(0, 100).map((change, index) => (
                  <li key={index}>
                    <button
                      className={`compare-region ${region === index ? 'active' : ''}`}
                      aria-pressed={region === index}
                      onClick={() => {
                        setRegion(index)
                        setMode('difference')
                      }}
                    >
                      <strong>Region {index + 1}</strong>
                      <span>{change.pixels.toLocaleString()} pixels</span>
                      <small>
                        x {Math.round(change.x / frames!.scale)}, y{' '}
                        {Math.round(change.y / frames!.scale)} ·{' '}
                        {Math.round(change.width / frames!.scale)}×
                        {Math.round(change.height / frames!.scale)}
                      </small>
                    </button>
                  </li>
                ))}
              </ol>
              {result.regions.length > 100 && (
                <p className="tiny muted">
                  Showing the 100 largest regions. The percentage includes all changes.
                </p>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
