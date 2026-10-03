import React, { useEffect, useId, useRef } from 'react'
import { Icon } from './icons'

/** A reversible review step before permanently removing local work. */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onCancel
}: {
  title: string
  children: React.ReactNode
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.ReactElement {
  const titleId = useId()
  const detailId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => {
    if (busy) dialogRef.current?.focus()
  }, [busy])
  return (
    <div
      className="confirm-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <section
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detailId}
        aria-busy={busy}
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape' && !busy) {
            event.preventDefault()
            onCancel()
          }
          if (event.key !== 'Tab') return
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
          )
          if (!controls.length) {
            event.preventDefault()
            return
          }
          const first = controls[0],
            last = controls[controls.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <Icon name="alert" size={24} />
        <h2 id={titleId}>{title}</h2>
        <div id={detailId}>{children}</div>
        <div className="confirm-actions">
          <button className="btn" data-cancel disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn danger" disabled={busy} onClick={onConfirm}>
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
