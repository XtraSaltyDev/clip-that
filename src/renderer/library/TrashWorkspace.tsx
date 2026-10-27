import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryItemView } from '@shared/types'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import ConfirmDialog from '../shared/ConfirmDialog'
import { useDebouncedValue } from '../shared/preferences'
import { formatBytes, formatRelative, toast, useHotkeys } from '../shared/ui'

const PAGE_SIZE = 120

export default function TrashWorkspace({ onBack }: { onBack: () => void }): React.ReactElement {
  const [items, setItems] = useState<LibraryItemView[]>([])
  const [search, setSearch] = useState('')
  const settledSearch = useDebouncedValue(search)
  const [selected, setSelected] = useState<string[]>([])
  const [pending, setPending] = useState<LibraryItemView[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const moreInFlight = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const query = { trashed: true, search: settledSearch, limit: PAGE_SIZE } as const

  const refresh = useCallback(async () => {
    const request = ++generation.current
    setLoading(true)
    try {
      const list = await api.library.list({
        trashed: true,
        search: settledSearch,
        limit: PAGE_SIZE
      })
      if (request !== generation.current) return
      setItems(list)
      setSelected((ids) => ids.filter((id) => list.some((item) => item.id === id)))
      setHasMore(list.length === PAGE_SIZE)
      setError(null)
    } catch (err) {
      if (request === generation.current) setError((err as Error).message)
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [settledSearch])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    void refresh()
    const off = api.library.onChanged(() => void refresh())
    return () => {
      generation.current++
      off()
    }
  }, [refresh])

  const loadMore = async () => {
    if (moreInFlight.current || loading || !hasMore) return
    moreInFlight.current = true
    setLoadingMore(true)
    const request = generation.current
    try {
      const list = await api.library.list({ ...query, offset: items.length })
      if (request !== generation.current) return
      setItems((current) => {
        const ids = new Set(current.map((item) => item.id))
        return [...current, ...list.filter((item) => !ids.has(item.id))]
      })
      setHasMore(list.length === PAGE_SIZE)
      setError(null)
    } catch (err) {
      if (request === generation.current)
        toast('error', 'Could not load more Trash items', (err as Error).message)
    } finally {
      moreInFlight.current = false
      setLoadingMore(false)
    }
  }

  const act = async (permanent: boolean) => {
    const ids = permanent ? pending.map((item) => item.id) : selected
    if (!ids.length || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      if (permanent) await api.library.purge(ids)
      else await api.library.restore(ids)
      setSelected([])
      setPending([])
      toast(
        'success',
        `${permanent ? 'Permanently deleted' : 'Restored'} ${ids.length} item${ids.length === 1 ? '' : 's'}`
      )
      await refresh()
      requestAnimationFrame(() => searchRef.current?.focus())
    } catch (err) {
      toast(
        'error',
        permanent ? 'Could not finish permanent deletion' : 'Could not restore captures',
        (err as Error).message
      )
      // Refresh file health after a partial filesystem failure; keep the named review open.
      await refresh()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const ready = !busy && !loading && !error && search === settledSearch
  const reviewDelete = () => {
    if (ready && selected.length) setPending(items.filter((item) => selected.includes(item.id)))
  }
  useHotkeys(
    {
      'mod+f': () => searchRef.current?.focus(),
      escape: () => (search ? setSearch('') : onBack()),
      delete: reviewDelete,
      backspace: reviewDelete
    },
    !pending.length && !busy
  )

  return (
    <div className="lib-shell">
      <header className="guide-top drag-region">
        <button className="btn ghost no-drag" disabled={busy} onClick={onBack}>
          <Icon name="chevronLeft" size={14} /> Library
        </button>
        <h1 className="trash-title">Trash</h1>
        <div className="lib-search no-drag">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            className="lib-search-input"
            aria-label="Search Trash"
            placeholder="Search Trash…"
            value={search}
            disabled={busy}
            onChange={(event) => {
              setSearch(event.target.value)
              setSelected([])
            }}
          />
          {search && (
            <button
              className="btn ghost icon sm"
              aria-label="Clear search"
              disabled={busy}
              onClick={() => setSearch('')}
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      </header>
      <main className="trash-main">
        <p className="trash-explainer">
          Restore captures with their tags, favourites and editable projects. Items stay here until
          you permanently delete them. External exports stay in their folders.
        </p>
        <div className="trash-actions">
          <label className="row">
            <input
              type="checkbox"
              aria-label="Select all loaded Trash items"
              disabled={!ready || !items.length}
              checked={items.length > 0 && selected.length === items.length}
              onChange={(event) =>
                setSelected(event.target.checked ? items.map((item) => item.id) : [])
              }
            />
            {selected.length
              ? `${selected.length} selected`
              : `${items.length}${hasMore ? '+' : ''} items loaded`}
          </label>
          <div className="spacer" />
          <button
            className="btn primary"
            disabled={!ready || !selected.length}
            onClick={() => void act(false)}
          >
            Restore selected
          </button>
          <button
            className="btn danger"
            disabled={!ready || !selected.length}
            onClick={reviewDelete}
          >
            Delete permanently…
          </button>
        </div>
        {error && (
          <div className="lib-query-status" role="alert">
            Could not refresh Trash: {error}{' '}
            <button className="btn sm" disabled={busy} onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        {loading && <p role="status">Loading Trash…</p>}
        {!loading && !error && items.length === 0 && (
          <div className="empty">
            <Icon name="trash" size={32} />
            <div>{search ? 'No Trash items matched that search' : 'Trash is empty'}</div>
            <div className="tiny">
              {search
                ? 'Try another search or clear it.'
                : 'Captures you delete from the Library appear here.'}
            </div>
          </div>
        )}
        <div className="trash-list" aria-label="Trashed captures" aria-busy={loading}>
          {items.map((item) => (
            <label
              className={`trash-item ${selected.includes(item.id) ? 'selected' : ''}`}
              key={item.id}
            >
              <input
                type="checkbox"
                aria-label={`Select ${item.title}`}
                checked={selected.includes(item.id)}
                disabled={!ready}
                onChange={(event) =>
                  setSelected((ids) =>
                    event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id)
                  )
                }
              />
              <div className="trash-thumb">
                {item.thumbnail ? (
                  <img src={api.library.fileUrl(item.thumbnail)} alt="" loading="lazy" />
                ) : (
                  <Icon name={item.kind === 'image' ? 'image' : 'video'} size={24} />
                )}
              </div>
              <div className="trash-item-info">
                <strong className="truncate">{item.title}</strong>
                <span className="tiny muted">
                  {item.kind === 'image' ? 'Image' : 'Recording'} · {formatBytes(item.byteSize)} ·
                  Moved to Trash {formatRelative(item.deletedAt!)}
                </span>
                {item.workbench.source.state !== 'available' && (
                  <span className="tiny">
                    {item.workbench.source.label}. Restore keeps this file status.
                  </span>
                )}
              </div>
            </label>
          ))}
        </div>
        {hasMore && (
          <div className="lib-more">
            <button
              className="btn"
              disabled={!ready || loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? 'Loading…' : 'Load more Trash items'}
            </button>
          </div>
        )}
      </main>
      {pending.length > 0 && (
        <ConfirmDialog
          title={`Permanently delete ${pending.length === 1 ? 'this capture' : `${pending.length} captures`}?`}
          confirmLabel="Delete permanently"
          busy={busy}
          onCancel={() => setPending([])}
          onConfirm={() => void act(true)}
        >
          <p>
            This removes the capture files and linked editable projects. This cannot be undone.
            External exports remain in their folders. Close editor windows before continuing.
          </p>
          <ul>
            {pending.slice(0, 10).map((item) => (
              <li className="truncate" key={item.id}>
                {item.title}
              </li>
            ))}
          </ul>
          {pending.length > 10 && <p>And {pending.length - 10} more.</p>}
        </ConfirmDialog>
      )}
    </div>
  )
}
