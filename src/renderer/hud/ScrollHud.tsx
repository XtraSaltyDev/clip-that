import React, { useEffect, useState } from 'react'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import { useTheme } from '../shared/ui'
import './hud.css'

/**
 * Floating controller for a scrolling capture. It stays out of the way while the user
 * scrolls the window underneath; main keeps grabbing frames until Done is pressed.
 */
export default function ScrollHud(): React.ReactElement {
  useTheme()
  const [frames, setFrames] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => api.capture.onScrollFrameCount(setFrames), [])

  const done = async () => {
    setBusy(true)
    await api.capture.finishScrolling()
  }

  return (
    <div className="hud-bar drag-region scroll">
      <span className="hud-rec" />
      <div className="no-drag" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12 }}>
          {busy ? 'Stitching…' : 'Scroll the content'}
        </div>
        <div className="tiny muted">
          {frames} frame{frames === 1 ? '' : 's'} captured
        </div>
      </div>
      <span className="spacer" />
      <button className="btn sm primary no-drag" disabled={busy || frames === 0} onClick={done}>
        <Icon name="check" size={13} /> Done
      </button>
      <button
        className="hud-btn no-drag"
        title="Cancel"
        onClick={() => {
          api.capture.cancel()
          api.hud.close()
        }}
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}
