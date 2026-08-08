import React, { useCallback, useEffect, useState } from 'react'
import type { LibraryItem } from '@shared/types'
import { api } from '../../shared/api'
import { Icon } from '../../shared/icons'
import { formatRelative } from '../../shared/ui'

const PAGE_SIZE = 500

async function listEveryLibraryItem(): Promise<LibraryItem[]> {
  const items: LibraryItem[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await api.library.list({ limit: PAGE_SIZE, offset })
    items.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return [...new Map(items.map((item) => [item.id, item])).values()].sort(
    (a, b) => b.createdAt - a.createdAt
  )
}

export default function LibraryStrip(props: {
  activeId: string | null
  openingId: string | null
  onOpen: (item: LibraryItem) => void
}): React.ReactElement {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setItems(await listEveryLibraryItem())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return api.library.onChanged(() => void refresh())
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
          {!loading && <span className="editor-library-count">{items.length}</span>}
        </button>
        <span className="editor-library-order">Newest first</span>
      </div>

      <div
        className="editor-library-items"
        onWheel={(event) => {
          if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
          event.currentTarget.scrollLeft += event.deltaY
        }}
      >
        {!loading && items.length === 0 && (
          <div className="editor-library-empty">Saved captures and recordings will appear here.</div>
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
