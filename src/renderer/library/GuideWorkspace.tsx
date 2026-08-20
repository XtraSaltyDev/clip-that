import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CaptureMode, GuideDocument, GuideStep } from '@shared/types'
import { moveGuideStep, renumberGuideSteps } from '@shared/guides'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import { toast } from '../shared/ui'

type SaveState = 'Saved' | 'Saving' | 'Error'
type GuideCaptureMode = Exclude<CaptureMode, 'scrolling'>

export default function GuideWorkspace(props: {
  guideId: string
  onBack: () => void
  onDeleted: () => void
}): React.ReactElement {
  const [guide, setGuide] = useState<GuideDocument | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('Saved')
  const [captureMode, setCaptureMode] = useState<GuideCaptureMode>('region')
  const [capturing, setCapturing] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [undoStep, setUndoStep] = useState<{ step: GuideStep; index: number } | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revision = useRef(0)

  const load = useCallback(async () => {
    const next = await api.guides.get(props.guideId)
    if (!next) {
      toast('error', 'Guide could not be opened')
      props.onBack()
      return
    }
    setGuide(next)
    setSelectedId((current) =>
      current && next.steps.some((step) => step.id === current)
        ? current
        : (next.steps[0]?.id ?? null)
    )
  }, [props.guideId, props.onBack])

  useEffect(() => {
    void load()
    const off = api.guides.onChanged(({ guideId }) => {
      if (guideId === props.guideId) void load()
    })
    const offHotkey = api.guides.onHotkeyCapture((result) => {
      if (result.guideId !== props.guideId) return
      if (!result.ok) toast('error', 'Guide capture failed', result.error)
      else toast('success', 'Guide step captured')
    })
    return () => {
      off()
      offHotkey()
      if (saveTimer.current) clearTimeout(saveTimer.current)
      void api.guides.setActive(null)
    }
  }, [load, props.guideId])

  const queueSave = useCallback((next: GuideDocument) => {
    const currentRevision = ++revision.current
    setGuide(next)
    setSaveState('Saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void api.guides
        .save(next)
        .then((saved) => {
          if (revision.current !== currentRevision) return
          setGuide(saved)
          setSaveState('Saved')
        })
        .catch((error) => {
          if (revision.current !== currentRevision) return
          setSaveState('Error')
          toast('error', 'Guide could not be saved', (error as Error).message)
        })
    }, 450)
  }, [])

  const selected = useMemo(
    () => guide?.steps.find((step) => step.id === selectedId) ?? null,
    [guide, selectedId]
  )

  const updateGuide = (patch: Partial<Pick<GuideDocument, 'title' | 'description'>>): void => {
    if (!guide) return
    queueSave({ ...guide, ...patch, updatedAt: Date.now() })
  }

  const updateStep = (patch: Partial<GuideStep>): void => {
    if (!guide || !selected) return
    queueSave({
      ...guide,
      steps: guide.steps.map((step) =>
        step.id === selected.id ? { ...step, ...patch, updatedAt: Date.now() } : step
      )
    })
  }

  const capture = async (): Promise<void> => {
    if (!guide || capturing) return
    setCapturing(true)
    try {
      const next = await api.guides.capture(guide.id, captureMode)
      if (next) {
        setGuide(next)
        setSelectedId(next.steps.at(-1)?.id ?? null)
        setSaveState('Saved')
      }
    } catch (error) {
      toast('error', 'Capture failed', (error as Error).message)
    } finally {
      setCapturing(false)
    }
  }

  const importStep = async (): Promise<void> => {
    if (!guide) return
    const next = await api.guides.importStep(guide.id)
    if (next) {
      setGuide(next)
      setSelectedId(next.steps.at(-1)?.id ?? null)
    }
  }

  const move = (stepId: string, index: number): void => {
    if (!guide) return
    queueSave({ ...guide, steps: moveGuideStep(guide.steps, stepId, index) })
  }

  const duplicate = (): void => {
    if (!guide || !selected || guide.steps.length >= 100) return
    const now = Date.now()
    const stepId = crypto.randomUUID()
    const copy: GuideStep = {
      ...structuredClone(selected),
      id: stepId,
      title: `${selected.title} copy`,
      createdAt: now,
      updatedAt: now,
      project: { ...structuredClone(selected.project), id: stepId, createdAt: now, updatedAt: now }
    }
    const index = selected.order + 1
    const steps = [...guide.steps]
    steps.splice(index, 0, copy)
    queueSave({ ...guide, steps: renumberGuideSteps(steps) })
    setSelectedId(stepId)
  }

  const removeStep = (): void => {
    if (!guide || !selected) return
    const index = selected.order
    setUndoStep({ step: selected, index })
    const steps = renumberGuideSteps(guide.steps.filter((step) => step.id !== selected.id))
    queueSave({ ...guide, steps })
    setSelectedId(steps[Math.min(index, steps.length - 1)]?.id ?? null)
  }

  const undoDelete = (): void => {
    if (!guide || !undoStep) return
    const steps = [...guide.steps]
    steps.splice(undoStep.index, 0, undoStep.step)
    queueSave({ ...guide, steps: renumberGuideSteps(steps) })
    setSelectedId(undoStep.step.id)
    setUndoStep(null)
  }

  const recapture = async (): Promise<void> => {
    if (!guide || !selected || capturing) return
    setCapturing(true)
    try {
      const next = await api.guides.recapture(guide.id, selected.id, captureMode)
      if (next) setGuide(next)
    } catch (error) {
      toast('error', 'Recapture failed', (error as Error).message)
    } finally {
      setCapturing(false)
    }
  }

  const toggleSession = async (): Promise<void> => {
    if (!guide) return
    const next = !sessionActive
    await api.guides.setActive(next ? guide.id : null)
    setSessionActive(next)
    toast(
      'info',
      next ? 'Guide capture session started' : 'Guide capture session stopped',
      next ? 'Use the configured Capture next guide step shortcut from any app.' : undefined
    )
  }

  const exportAs = async (format: 'markdown' | 'html' | 'pdf'): Promise<void> => {
    if (!guide) return
    const result = await api.guides.export(guide.id, format)
    if (result.ok)
      toast(
        'success',
        `${format === 'markdown' ? 'Markdown' : format.toUpperCase()} guide exported`,
        result.filePath
      )
    else if (!result.canceled) toast('error', 'Guide export failed', result.error)
  }

  if (!guide) {
    return (
      <div className="guide-loading" role="status">
        Loading guide…
      </div>
    )
  }

  return (
    <section className="guide-workspace" aria-label="Guide Builder">
      <header className="guide-top">
        <button className="btn ghost icon" aria-label="Back to Guides" onClick={props.onBack}>
          <Icon name="chevronLeft" />
        </button>
        <input
          className="guide-title"
          value={guide.title}
          aria-label="Guide title"
          onChange={(event) => updateGuide({ title: event.target.value })}
        />
        <span className={`guide-save-state ${saveState.toLowerCase()}`} role="status">
          {saveState === 'Saved' && <Icon name="check" size={13} />}
          {saveState}
        </span>
        <div className="spacer" />
        <select
          className="field guide-capture-mode"
          aria-label="Guide capture mode"
          value={captureMode}
          onChange={(event) => setCaptureMode(event.target.value as GuideCaptureMode)}
        >
          <option value="region">Region</option>
          <option value="window">Window</option>
          <option value="display">Display</option>
          <option value="fullscreen">All displays</option>
          <option value="lastRegion">Last region</option>
        </select>
        <button className="btn primary" disabled={capturing} onClick={() => void capture()}>
          <Icon name="camera" size={14} /> {capturing ? 'Capturing…' : 'Capture next'}
        </button>
        <button className="btn" onClick={() => void importStep()}>
          <Icon name="plus" size={14} /> Add existing
        </button>
        <button
          className={`btn ${sessionActive ? 'danger' : ''}`}
          aria-pressed={sessionActive}
          onClick={() => void toggleSession()}
        >
          <Icon name={sessionActive ? 'stop' : 'play'} size={13} />{' '}
          {sessionActive ? 'Stop session' : 'Start session'}
        </button>
        <div className="guide-export" aria-label="Export guide">
          <button className="btn" onClick={() => void exportAs('markdown')}>
            Markdown
          </button>
          <button className="btn" onClick={() => void exportAs('html')}>
            HTML
          </button>
          <button className="btn" onClick={() => void exportAs('pdf')}>
            PDF
          </button>
        </div>
      </header>

      <div className="guide-layout">
        <aside className="guide-steps" aria-label="Guide steps">
          <div className="guide-section-head">
            <strong>Steps</strong>
            <span>{guide.steps.length}/100</span>
          </div>
          {guide.steps.length === 0 ? (
            <div className="guide-empty">
              <Icon name="image" size={28} />
              <strong>Add your first step</strong>
              <span>Capture a region or import an image or .clipthat project.</span>
            </div>
          ) : (
            <ol>
              {guide.steps.map((step, index) => (
                <li key={step.id}>
                  <button
                    className={`guide-step ${selectedId === step.id ? 'selected' : ''}`}
                    aria-current={selectedId === step.id ? 'step' : undefined}
                    draggable
                    onDragStart={() => setDraggedId(step.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggedId) move(draggedId, index)
                      setDraggedId(null)
                    }}
                    onClick={() => setSelectedId(step.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' && index > 0) {
                        event.preventDefault()
                        move(step.id, index - 1)
                      }
                      if (event.key === 'ArrowDown' && index < guide.steps.length - 1) {
                        event.preventDefault()
                        move(step.id, index + 1)
                      }
                    }}
                  >
                    <span className="guide-step-number">{index + 1}</span>
                    <img src={step.thumbnail} alt="" />
                    <span className="truncate">{step.title || `Step ${index + 1}`}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>

        <main className="guide-preview">
          {selected ? (
            <img
              src={selected.renderedImage ?? selected.image}
              alt={`Step ${selected.order + 1}: ${selected.title}`}
            />
          ) : (
            <div className="guide-preview-empty">Select a step to preview it.</div>
          )}
        </main>

        <aside className="guide-inspector" aria-label="Step details">
          {selected ? (
            <>
              <label>
                Step title
                <input
                  className="field"
                  value={selected.title}
                  onChange={(event) => updateStep({ title: event.target.value })}
                />
              </label>
              <label>
                Description
                <textarea
                  className="field"
                  rows={7}
                  value={selected.description}
                  onChange={(event) => updateStep({ description: event.target.value })}
                />
              </label>
              <div className="guide-step-actions">
                <button
                  className="btn primary"
                  onClick={() => void api.guides.editStep(guide.id, selected.id)}
                >
                  <Icon name="edit" size={14} /> Annotate
                </button>
                <button className="btn" onClick={() => void recapture()}>
                  <Icon name="refresh" size={14} /> Recapture
                </button>
                <button className="btn" onClick={duplicate}>
                  <Icon name="copy" size={14} /> Duplicate
                </button>
                <button
                  className="btn"
                  disabled={selected.order === 0}
                  onClick={() => move(selected.id, selected.order - 1)}
                >
                  <Icon name="chevronLeft" size={14} /> Earlier
                </button>
                <button
                  className="btn"
                  disabled={selected.order === guide.steps.length - 1}
                  onClick={() => move(selected.id, selected.order + 1)}
                >
                  Later <Icon name="chevronRight" size={14} />
                </button>
                <button className="btn danger" onClick={removeStep}>
                  <Icon name="trash" size={14} /> Delete
                </button>
              </div>
              <div className="guide-source-note tiny muted">
                {selected.source?.kind === 'import'
                  ? 'Imported locally'
                  : `Captured · ${selected.source?.captureMode ?? 'source unknown'}`}
              </div>
            </>
          ) : (
            <div className="guide-inspector-empty">Step details appear here.</div>
          )}
          <div className="guide-session-note">
            <Icon name="info" size={14} />
            <div>
              <strong>Automatic click capture unavailable</strong>
              <span>
                Manual capture and the configurable global shortcut work without monitoring clicks
                or keys.
              </span>
            </div>
          </div>
        </aside>
      </div>

      <footer className="guide-footer">
        <label>
          Guide description
          <input
            className="field"
            value={guide.description}
            onChange={(event) => updateGuide({ description: event.target.value })}
            placeholder="What will this guide help someone do?"
          />
        </label>
        {undoStep && (
          <div className="guide-undo" role="status">
            Step deleted{' '}
            <button className="btn sm" onClick={undoDelete}>
              Undo
            </button>
          </div>
        )}
        <button
          className="btn ghost danger"
          onClick={async () => {
            if (!window.confirm(`Delete “${guide.title}”? This cannot be undone.`)) return
            if (await api.guides.remove(guide.id)) props.onDeleted()
          }}
        >
          Delete guide
        </button>
      </footer>
    </section>
  )
}
