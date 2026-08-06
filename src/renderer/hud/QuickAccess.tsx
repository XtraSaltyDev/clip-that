import React, { useEffect, useState } from 'react'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import './hud.css'

interface Payload {
  id: string
  thumb: string
  width: number
  height: number
}

/**
 * The Quick Access card. Everything a capture usually needs, two seconds after the
 * hotkey: drag the thumbnail into another app, or copy / save / pin / edit. Stays until
 * dismissed; a newer capture replaces its contents.
 */
export default function QuickAccess(): React.ReactElement | null {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(
    () =>
      api.quick.onInit((p) => {
        setPayload(p as Payload)
        setDone(null)
      }),
    []
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!payload) return
      if (e.key === 'Escape') api.system.window('close')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') void act('copy')
      if (e.key === 'Enter') void act('edit')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const act = async (action: 'copy' | 'save' | 'pin' | 'edit') => {
    if (!payload) return
    const res = await api.quick.action(payload.id, action)
    if (!res.ok) {
      setDone(res.error ?? 'failed')
      return
    }
    // Copy and save confirm briefly, then get out of the way; pin/edit dismiss at once.
    if (action === 'copy' || action === 'save') {
      setDone(action === 'copy' ? 'Copied' : 'Saved')
      setTimeout(() => api.system.window('close'), 900)
    } else {
      api.system.window('close')
    }
  }

  if (!payload) return null

  return (
    <div className="qa">
      <div
        className="qa-thumb"
        title="Drag into another app"
        draggable
        onDragStart={(e) => {
          e.preventDefault()
          void api.quick.drag(payload.id)
        }}
      >
        <img src={payload.thumb} alt="" draggable={false} />
        {done && (
          <div className="qa-done">
            <Icon name="check" size={16} />
            {done}
          </div>
        )}
      </div>

      <div className="qa-body">
        <div className="qa-meta tiny muted mono">
          {payload.width}×{payload.height}
        </div>
        <div className="qa-actions">
          <button className="qa-btn" onClick={() => void act('copy')} title="Copy  ·  ⌘C">
            <Icon name="copy" size={14} />
            Copy
          </button>
          <button className="qa-btn" onClick={() => void act('save')} title="Save to your folder">
            <Icon name="download" size={14} />
            Save
          </button>
          <button className="qa-btn" onClick={() => void act('pin')} title="Float on screen">
            <Icon name="lock" size={14} />
            Pin
          </button>
          <button className="qa-btn primary" onClick={() => void act('edit')} title="Annotate  ·  ⏎">
            <Icon name="pen" size={14} />
            Edit
          </button>
        </div>
        <div className="qa-hint tiny muted">drag the image out · esc to dismiss</div>
      </div>

      <button className="qa-close" title="Dismiss (Esc)" onClick={() => api.system.window('close')}>
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}
