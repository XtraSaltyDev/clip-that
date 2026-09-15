import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryItem } from '@shared/types'
import { api } from '../../shared/api'
import { Icon } from '../../shared/icons'
import { formatRelative } from '../../shared/ui'

const RECENT_LIMIT = 50

export default function LibraryStrip(props: {
  activeId: string | null
  openingId: string | null
  onOpen: (item: LibraryItem) => void
}): React.ReactElement {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const next = await api.library.list({ limit: RECENT_LIMIT + 1 })
      if (request !== generation.current) return
      setItems(next.slice(0, RECENT_LIMIT))
      setHasMore(next.length > RECENT_LIMIT)
      setError(false)
    } catch {
      if (request === generation.current) setError(true)
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const off = api.library.onChanged(() => void refresh())
    return () => {
      generation.current++
      off()
    }
  }, [refresh])

  return (
    <section className="editor-library-strip" aria-label="Recent Library items">
      <div className="editor-library-heading">
        <button
          className="editor-library-open"
          onClick={() => api.system.window('library')}
          title="Open the full Library"
        >
          <Icon name="layers" size={15} />
          <span>Library</span>
          {!loading && !error && (
            <span className="editor-library-count">
              {items.length}
              {hasMore ? '+' : ''}
            </span>
          )}
        </button>
        <span className="editor-library-order">{hasMore ? '50 most recent' : 'Newest first'}</span>
      </div>

      <div
        className="editor-library-items"
        onWheel={(event) => {
          if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
          event.currentTarget.scrollLeft += event.deltaY
        }}
      >
        {error && (
          <div className="editor-library-empty" role="status">
            Recent captures could not be loaded.{' '}
            <button className="btn ghost sm" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="editor-library-empty">
            Saved captures and recordings will appear here.
          </div>
        )}
        {items.map((item) => {
          const thumbnail = item.thumbnail ? api.library.fileUrl(item.thumbnail) : undefined
          const active = props.activeId === item.id
          const opening = props.openingId === item.id
          return (
            <button
              key={item.id}
              className={`editor-library-item ${active ? 'active' : ''}`}
              aria-pressed={active}
              aria-label={`${item.kind === 'video' ? 'Play recording' : 'Edit capture'} ${item.title}`}
              title={`${item.title} · ${formatRelative(item.createdAt)}`}
              disabled={props.openingId !== null}
              onClick={() => props.onOpen(item)}
            >
              <span className="editor-library-thumb">
                {thumbnail ? (
                  <img src={thumbnail} alt="" loading="lazy" />
                ) : (
                  <Icon name={item.kind === 'video' ? 'video' : 'image'} size={21} />
                )}
                {item.kind === 'video' && (
                  <span className="editor-library-video">
                    <Icon name="play" size={9} />
                  </span>
                )}
                {opening && <span className="editor-library-loading" />}
              </span>
              <span className="editor-library-title">{item.title}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
