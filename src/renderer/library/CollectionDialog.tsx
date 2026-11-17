import React, { useEffect, useRef, useState } from 'react'
import type { LibraryCollectionInput } from '@shared/types'
import { api } from '../shared/api'
import { toast } from '../shared/ui'

export default function CollectionDialog({
  draft,
  onSaved,
  onClose
}: {
  draft: LibraryCollectionInput
  onSaved: () => void
  onClose: () => void
}): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const [name, setName] = useState(draft.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  const save = async (remove = false) => {
    if (inFlight.current || (!remove && !name.trim())) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      if (remove && draft.id) await api.library.removeCollection(draft.id)
      else await api.library.saveCollection({ ...draft, name })
      toast(
        'success',
        remove ? 'Collection removed' : draft.id ? 'Collection updated' : 'Collection saved'
      )
      onSaved()
      onClose()
    } catch (error) {
      setError((error as Error).message || 'The collection could not be saved. Try again.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      className="lib-collection-dialog"
      aria-labelledby="collection-title"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault()
        if (!inFlight.current) onClose()
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <h2 id="collection-title">{draft.id ? 'Edit collection' : 'Save collection'}</h2>
        <label className="label" htmlFor="collection-name">
          Name
        </label>
        <input
          id="collection-name"
          className="field"
          value={name}
          maxLength={80}
          required
          autoFocus
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <p className="small muted">
          This collection opens its saved search, filters and sort order. New matching captures
          appear automatically.
        </p>
        {error && (
          <p className="lib-collection-error" role="alert">
            {error}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {draft.id && (
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Remove collection
            </button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            {busy ? 'Working…' : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
