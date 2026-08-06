import React, { useEffect, useState } from 'react'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import './hud.css'

/**
 * A pinned screenshot: the image, a close control on hover, and nothing else.
 * Drag anywhere to move; scroll to change opacity; double-click or Esc to dismiss.
 */
export default function Pin(): React.ReactElement | null {
  const [src, setSrc] = useState<string | null>(null)
  const [opacity, setOpacity] = useState(1)

  useEffect(() => api.pin.onInit(({ dataUrl }) => setSrc(dataUrl)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') api.system.window('close')
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setOpacity((o) => Math.min(1, Math.max(0.25, o - Math.sign(e.deltaY) * 0.08)))
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

  if (!src) return null

  return (
    <div className="pin drag-region" style={{ opacity }} onDoubleClick={() => api.system.window('close')}>
      <img src={src} alt="" draggable={false} />
      <button
        className="pin-close no-drag"
        title="Close (Esc, or double-click)"
        onClick={() => api.system.window('close')}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}
