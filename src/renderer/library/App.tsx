import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppUpdateStatus, LibraryHealth, LibraryItem } from '@shared/types'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import {
  Segmented,
  ToastHost,
  formatBytes,
  formatDuration,
  formatRelative,
  toast,
  useHotkeys,
  useTheme
} from '../shared/ui'
import CommandPalette, { type Command } from '../shared/CommandPalette'
import './library.css'

type Filter = 'all' | 'image' | 'video' | 'favorite'

export default function App(): React.ReactElement {
  useTheme()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [loading, setLoading] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [health, setHealth] = useState<LibraryHealth | null>(null)
  const [update, setUpdate] = useState<AppUpdateStatus | null>(null)
  const [openingUpdate, setOpeningUpdate] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const query = {
      search: search.trim() || undefined,
      kind: filter === 'image' || filter === 'video' ? filter : undefined,
      favorite: filter === 'favorite' || undefined,
      tag: tag ?? undefined
    }
    try {
      const [list, allTags] = await Promise.all([api.library.list(query), api.library.tags()])
      setItems(list)
      setTags(allTags)
    } catch (error) {
      toast('error', 'Could not load the Library', (error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [search, filter, tag])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => api.library.onChanged(() => void refresh()), [refresh])

  useEffect(() => {
    void api.library.health().then(setHealth)
    return api.library.onIssue((next) => {
      setHealth(next)
      if (next.status !== 'ok') {
        toast(next.status === 'error' ? 'error' : 'info', next.message, next.detail)
      }
    })
  }, [])

  useEffect(() => {
    let active = true
    void api.system.checkForUpdate().then((status) => {
      if (active) setUpdate(status)
    }).catch(() => {
      // Update discovery is intentionally quiet when GitHub Releases is unavailable off VPN.
    })
    const unsubscribe = api.system.onUpdateStatus((status) => {
      if (active) setUpdate(status)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const downloadUpdate = useCallback(async () => {
    if (openingUpdate || update?.state !== 'available') return
    setOpeningUpdate(true)
    try {
      const result = await api.system.downloadUpdate()
      if (result.ok) {
        toast('success', 'Update ready', `ClipThat ${update.latestVersion} can now restart.`)
      } else {
        toast('error', 'Could not download the update', result.error)
        setUpdate(await api.system.checkForUpdate(true))
      }
    } catch (error) {
      toast('error', 'Could not download the update', (error as Error).message)
    } finally {
      setOpeningUpdate(false)
    }
  }, [openingUpdate, update])

  const installUpdate = useCallback(async () => {
    const result = await api.system.installUpdate()
    if (!result.ok) toast('error', 'ClipThat could not restart', result.error)
  }, [])

  const active = useMemo(
    () => (selected.length === 1 ? items.find((i) => i.id === selected[0]) : null),
    [items, selected]
  )

  // Captures arrive constantly, so a flat wall of thumbnails stops being navigable fast.
  // Day buckets give the library the shape of a timeline.
  const groups = useMemo(() => groupByDay(items), [items])
  const actionableUpdate =
    update?.state === 'available' || update?.state === 'downloading' || update?.state === 'ready'
      ? update
      : null

  const remove = useCallback(async () => {
    if (selected.length === 0) return
    try {
      await api.library.remove(selected)
      setSelected([])
      toast('success', `Deleted ${selected.length} item${selected.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast('error', 'Could not delete the selected items', (error as Error).message)
    }
  }, [selected])

  const copy = useCallback(async (item: LibraryItem) => {
    if (item.kind !== 'image') {
      toast('info', 'Only images can be copied to the clipboard')
      return
    }
    const url = api.library.fileUrl(item.filePath)
    const res = await fetch(url)
    const blob = await res.blob()
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(blob)
    })
    const ok = await api.exports.copyImage(dataUrl)
    toast(ok ? 'success' : 'error', ok ? 'Copied to clipboard' : 'Copy failed')
  }, [])

  /** Move the selection through the grid with the keyboard. */
  const step = useCallback(
    (delta: number) => {
      if (items.length === 0) return
      const current = selected.length ? items.findIndex((i) => i.id === selected[selected.length - 1]) : -1
      const next = Math.max(0, Math.min(items.length - 1, current + delta))
      setSelected([items[next].id])
    },
    [items, selected]
  )

  // Roughly how many cards fit per row, so up/down move a row rather than one card.
  const perRow = view === 'list' ? 1 : Math.max(1, Math.floor((window.innerWidth - 460) / 204))

  useHotkeys({ 'mod+k': () => setPaletteOpen((o) => !o) })

  useHotkeys(
    {
      'mod+f': () => searchRef.current?.focus(),
      'mod+a': () => setSelected(items.map((i) => i.id)),
      delete: () => void remove(),
      backspace: () => void remove(),
      escape: () => (search ? setSearch('') : setSelected([])),
      enter: () => active && void api.library.open(active.id),
      arrowright: () => step(1),
      arrowleft: () => step(-1),
      arrowdown: () => step(perRow),
      arrowup: () => step(-perRow),
      ' ': () => active && void api.library.open(active.id)
    },
    !paletteOpen
  )

  const commands = useMemo<Command[]>(
    () => [
      { id: 'cap.region', title: 'Capture region', group: 'Capture', icon: 'region', run: () => void api.capture.start({ mode: 'region' }) },
      { id: 'cap.window', title: 'Capture window', group: 'Capture', icon: 'window', run: () => void api.capture.start({ mode: 'window' }) },
      { id: 'cap.screen', title: 'Capture screen', group: 'Capture', icon: 'monitor', run: () => void api.capture.start({ mode: 'display' }) },
      { id: 'cap.scroll', title: 'Scrolling capture', group: 'Capture', icon: 'scroll', run: () => void api.capture.start({ mode: 'scrolling' }) },
      { id: 'cap.record', title: 'Record screen', group: 'Capture', icon: 'record', run: () => api.system.window('record') },
      { id: 'view.all', title: 'Show all captures', group: 'View', icon: 'layers', run: () => { setFilter('all'); setTag(null) } },
      { id: 'view.images', title: 'Show images only', group: 'View', icon: 'image', run: () => { setFilter('image'); setTag(null) } },
      { id: 'view.videos', title: 'Show recordings only', group: 'View', icon: 'video', run: () => { setFilter('video'); setTag(null) } },
      { id: 'view.fav', title: 'Show favourites', group: 'View', icon: 'star', run: () => { setFilter('favorite'); setTag(null) } },
      { id: 'view.grid', title: 'Grid view', group: 'View', icon: 'grid', run: () => setView('grid') },
      { id: 'view.list', title: 'List view', group: 'View', icon: 'list', run: () => setView('list') },
      ...tags.map((t) => ({
        id: `tag.${t}`,
        title: `Filter by tag: ${t}`,
        group: 'Tags',
        icon: 'tag' as const,
        run: () => { setTag(t); setFilter('all') }
      })),
      { id: 'item.open', title: 'Open selection', group: 'Selection', icon: 'pen', disabled: !active, run: () => { if (active) void api.library.open(active.id) } },
      { id: 'item.copy', title: 'Copy selection to clipboard', group: 'Selection', icon: 'copy', disabled: !active, run: () => { if (active) void copy(active) } },
      { id: 'item.reveal', title: 'Reveal in file manager', group: 'Selection', icon: 'folder', disabled: !active, run: () => { if (active) void api.exports.reveal(active.filePath) } },
      { id: 'item.star', title: active?.favorite ? 'Remove from favourites' : 'Add to favourites', group: 'Selection', icon: 'star', disabled: !active, run: async () => { if (active) { await api.library.update(active.id, { favorite: !active.favorite }); void refresh() } } },
      { id: 'item.delete', title: 'Delete selection', group: 'Selection', icon: 'trash', disabled: selected.length === 0, run: () => void remove() },
      { id: 'app.settings', title: 'Open settings', group: 'App', icon: 'settings', run: () => api.system.window('settings') }
    ],
    [active, copy, refresh, remove, selected.length, tags]
  )

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && selected.length > 0) {
      const last = selected[selected.length - 1]
      const a = items.findIndex((i) => i.id === last)
      const b = items.findIndex((i) => i.id === id)
      const [from, to] = a < b ? [a, b] : [b, a]
      setSelected(items.slice(from, to + 1).map((i) => i.id))
    } else if (e.metaKey || e.ctrlKey) {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
    } else {
      setSelected([id])
    }
  }

  return (
    <div className="lib-shell">
      <header className="lib-top drag-region">
        <div className="lib-search no-drag">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            className="lib-search-input"
            placeholder="Search titles, tags and text inside captures…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="btn ghost icon sm" onClick={() => setSearch('')}>
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
        <div className="spacer" />
        <div className="no-drag row" style={{ gap: 6 }}>
          <Segmented
            value={view}
            options={[
              { value: 'grid', label: <Icon name="grid" size={13} />, tip: 'Grid' },
              { value: 'list', label: <Icon name="list" size={13} />, tip: 'List' }
            ]}
            onChange={setView}
          />
          <button className="btn" onClick={() => void api.capture.start({ mode: 'region' })}>
            <Icon name="region" size={14} /> Capture
          </button>
          <button className="btn" onClick={() => api.system.window('record')}>
            <Icon name="record" size={11} /> Record
          </button>
          {actionableUpdate && (
            <button
              className="btn ghost icon tip focus-ring lib-update"
              data-tip={
                actionableUpdate.state === 'ready'
                  ? `Restart to install ClipThat ${actionableUpdate.latestVersion}`
                  : actionableUpdate.state === 'downloading'
                    ? `Downloading ClipThat ${actionableUpdate.latestVersion}: ${Math.round(actionableUpdate.percent)}%`
                    : `Download ClipThat ${actionableUpdate.latestVersion}`
              }
              title={
                actionableUpdate.state === 'ready'
                  ? `Restart to install ClipThat ${actionableUpdate.latestVersion}`
                  : `Download ClipThat ${actionableUpdate.latestVersion}`
              }
              aria-label={
                actionableUpdate.state === 'ready'
                  ? `Restart to install ClipThat ${actionableUpdate.latestVersion}`
                  : `Download ClipThat ${actionableUpdate.latestVersion}`
              }
              aria-busy={openingUpdate || actionableUpdate.state === 'downloading'}
              disabled={openingUpdate || actionableUpdate.state === 'downloading'}
              onClick={() =>
                void (actionableUpdate.state === 'ready' ? installUpdate() : downloadUpdate())
              }
            >
              <Icon
                name={actionableUpdate.state === 'ready' ? 'refresh' : 'update'}
                className={
                  openingUpdate || actionableUpdate.state === 'downloading' ? 'spin' : undefined
                }
              />
            </button>
          )}
          <button
            className="btn ghost icon tip focus-ring"
            data-tip="Settings"
            title="Settings"
            aria-label="Settings"
            onClick={() => api.system.window('settings')}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>

      {health && health.status !== 'ok' && (
        <div className={`lib-health ${health.status}`} role="status">
          <Icon name={health.status === 'error' ? 'alert' : 'info'} size={15} />
          <div>
            <strong>{health.message}</strong>
            {health.detail && <div className="tiny">{health.detail}</div>}
          </div>
        </div>
      )}

      <div className="lib-body">
        <nav className="lib-side">
          <div className="lib-side-group">
            {(
              [
                ['all', 'All captures', 'layers'],
                ['image', 'Images', 'image'],
                ['video', 'Recordings', 'video'],
                ['favorite', 'Favourites', 'star']
              ] as Array<[Filter, string, Parameters<typeof Icon>[0]['name']]>
            ).map(([key, label, icon]) => (
              <button
                key={key}
                className={`lib-nav ${filter === key && !tag ? 'active' : ''}`}
                onClick={() => {
                  setFilter(key)
                  setTag(null)
                }}
              >
                <Icon name={icon} size={15} />
                {label}
              </button>
            ))}
          </div>

          {tags.length > 0 && (
            <>
              <div className="label" style={{ padding: '14px 12px 6px' }}>
                Tags
              </div>
              <div className="lib-side-group">
                {tags.map((t) => (
                  <button
                    key={t}
                    className={`lib-nav ${tag === t ? 'active' : ''}`}
                    onClick={() => {
                      setTag(t)
                      setFilter('all')
                    }}
                  >
                    <Icon name="tag" size={15} />
                    {t}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="spacer" />
          <div className="lib-stats tiny muted">
            {items.length} item{items.length === 1 ? '' : 's'}
            <br />
            {formatBytes(items.reduce((sum, i) => sum + i.byteSize, 0))}
          </div>
        </nav>

        <main
          className={`lib-main ${view}`}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected([])
          }}
        >
          {loading ? null : items.length === 0 ? (
            <div className="empty">
              <Icon name="image" size={32} />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--ink-1)' }}>
                  {search ? 'Nothing matched that search' : 'Your library is empty'}
                </div>
                <div className="tiny">
                  {search
                    ? 'Try fewer words — captures are searchable by the text inside them.'
                    : 'Captures and recordings land here automatically.'}
                </div>
              </div>
              {!search && (
                <button className="btn" onClick={() => void api.capture.start({ mode: 'region' })}>
                  <Icon name="region" size={14} /> Take a capture
                </button>
              )}
            </div>
          ) : (
            groups.map((group) => (
              <React.Fragment key={group.label}>
                <div className="lib-group">
                  {group.label}
                  <span className="lib-group-count">{group.items.length}</span>
                </div>
                {group.items.map((item) => (
                  <Card
                    key={item.id}
                    item={item}
                    view={view}
                    selected={selected.includes(item.id)}
                    onSelect={(e) => toggleSelect(item.id, e)}
                    onOpen={() => void api.library.open(item.id)}
                  />
                ))}
              </React.Fragment>
            ))
          )}
        </main>

        {active && (
          <Details
            item={active}
            onCopy={() => void copy(active)}
            onDelete={() => void remove()}
            onChanged={refresh}
          />
        )}
      </div>

      {selected.length > 1 && (
        <div className="lib-selection">
          {selected.length} selected
          <button className="btn sm danger" onClick={() => void remove()}>
            <Icon name="trash" size={13} /> Delete
          </button>
          <button className="btn sm ghost" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
      )}

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
        placeholder="Search captures, filters and actions…"
      />

      <ToastHost />
    </div>
  )
}

/** Bucket captures into Today / Yesterday / weekday / date headings. */
function groupByDay(items: LibraryItem[]): Array<{ label: string; items: LibraryItem[] }> {
  const startOfDay = (t: number) => {
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const today = startOfDay(Date.now())
  const day = 86_400_000

  const groups: Array<{ label: string; items: LibraryItem[] }> = []
  for (const item of items) {
    const start = startOfDay(item.createdAt)
    const age = Math.round((today - start) / day)
    const label =
      age <= 0
        ? 'Today'
        : age === 1
          ? 'Yesterday'
          : age < 7
            ? new Date(item.createdAt).toLocaleDateString(undefined, { weekday: 'long' })
            : new Date(item.createdAt).toLocaleDateString(undefined, {
                month: 'long',
                day: 'numeric',
                year: start < today - day * 300 ? 'numeric' : undefined
              })
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

/* ------------------------------------------------------------------ */

function Card(props: {
  item: LibraryItem
  view: 'grid' | 'list'
  selected: boolean
  onSelect: (e: React.MouseEvent) => void
  onOpen: () => void
}): React.ReactElement {
  const { item } = props
  const src = item.thumbnail ? api.library.fileUrl(item.thumbnail) : undefined

  return (
    <article
      className={`lib-card ${props.selected ? 'selected' : ''}`}
      onMouseDown={props.onSelect}
      onDoubleClick={props.onOpen}
      title={item.title}
    >
      <div className="lib-thumb">
        {src ? <img src={src} alt="" loading="lazy" /> : <Icon name={item.kind === 'video' ? 'video' : 'image'} size={26} />}
        {item.kind === 'video' && (
          <span className="lib-badge">
            <Icon name="play" size={9} />
            {item.durationMs ? formatDuration(item.durationMs) : 'video'}
          </span>
        )}
        {item.favorite && (
          <span className="lib-fav">
            <Icon name="star" size={11} />
          </span>
        )}
      </div>
      <div className="lib-meta">
        <div className="truncate">{item.title}</div>
        <div className="tiny muted">
          {formatRelative(item.createdAt)} · {item.width}×{item.height}
        </div>
      </div>
    </article>
  )
}

function Details(props: {
  item: LibraryItem
  onCopy: () => void
  onDelete: () => void
  onChanged: () => void
}): React.ReactElement {
  const { item } = props
  const [title, setTitle] = useState(item.title)
  const [tagDraft, setTagDraft] = useState('')

  useEffect(() => setTitle(item.title), [item.id, item.title])

  const src = item.thumbnail ? api.library.fileUrl(item.thumbnail) : undefined
  const videoSrc = item.kind === 'video' ? api.library.fileUrl(item.filePath) : undefined

  const commitTitle = async () => {
    if (title.trim() && title !== item.title) {
      await api.library.update(item.id, { title: title.trim() })
      props.onChanged()
    }
  }

  const addTag = async () => {
    const value = tagDraft.trim()
    if (!value || item.tags.includes(value)) return
    await api.library.update(item.id, { tags: [...item.tags, value] })
    setTagDraft('')
    props.onChanged()
  }

  return (
    <aside className="lib-details">
      <div className="lib-preview">
        {videoSrc ? (
          <video src={videoSrc} controls preload="metadata" />
        ) : src ? (
          <img src={src} alt="" />
        ) : (
          <Icon name="image" size={30} />
        )}
      </div>

      <input
        className="field"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />

      <div className="lib-facts tiny">
        <div>
          <span className="muted">Kind</span> {item.kind === 'video' ? 'Recording' : 'Image'}
        </div>
        <div>
          <span className="muted">Size</span> {item.width} × {item.height}
        </div>
        <div>
          <span className="muted">File</span> {formatBytes(item.byteSize)}
        </div>
        {item.durationMs !== undefined && (
          <div>
            <span className="muted">Length</span> {formatDuration(item.durationMs)}
          </div>
        )}
        <div>
          <span className="muted">Created</span> {new Date(item.createdAt).toLocaleString()}
        </div>
      </div>

      <div className="lib-tags">
        {item.tags.map((t) => (
          <span key={t} className="lib-tag">
            {t}
            <button
              onClick={async () => {
                await api.library.update(item.id, { tags: item.tags.filter((x) => x !== t) })
                props.onChanged()
              }}
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        ))}
        <input
          className="lib-tag-input"
          placeholder="Add tag…"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void addTag()}
          onBlur={addTag}
        />
      </div>

      {item.ocrText && (
        <details className="lib-ocr">
          <summary className="tiny muted">Text found in this capture</summary>
          <div className="lib-ocr-body tiny mono">{item.ocrText}</div>
        </details>
      )}

      <div className="spacer" />

      <div className="lib-actions">
        <button className="btn" onClick={() => void api.library.open(item.id)}>
          <Icon name={item.kind === 'video' ? 'play' : 'pen'} size={14} />
          {item.kind === 'video' ? 'Edit video' : 'Edit'}
        </button>
        <button className="btn" onClick={props.onCopy}>
          <Icon name="copy" size={14} /> Copy
        </button>
        <button
          className="btn"
          onClick={async () => {
            await api.library.update(item.id, { favorite: !item.favorite })
            props.onChanged()
          }}
        >
          <Icon name="star" size={14} /> {item.favorite ? 'Unstar' : 'Star'}
        </button>
        <button className="btn" onClick={() => void api.exports.reveal(item.filePath)}>
          <Icon name="folder" size={14} /> Reveal
        </button>
        <button className="btn danger" onClick={props.onDelete}>
          <Icon name="trash" size={14} /> Delete
        </button>
      </div>
    </aside>
  )
}
