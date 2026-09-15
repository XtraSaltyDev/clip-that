import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppUpdateStatus,
  LibraryHealth,
  LibraryItem,
  LibraryItemView,
  GuideSummary,
  ReleaseNotesStatus,
  SnagitImportPreview,
  SnagitImportProgress,
  SnagitImportSummary
} from '@shared/types'
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
  useSize,
  useTheme
} from '../shared/ui'
import CommandPalette, { type Command } from '../shared/CommandPalette'
import { groupLibraryItems, libraryEmptyState, libraryGridColumns } from './layout'
import GuideWorkspace from './GuideWorkspace'
import './library.css'

type Filter = 'all' | 'image' | 'video' | 'favorite'

export default function App(): React.ReactElement {
  useTheme()
  const [items, setItems] = useState<LibraryItemView[]>([])
  const [guides, setGuides] = useState<GuideSummary[]>([])
  const [showGuides, setShowGuides] = useState(false)
  const [openGuideId, setOpenGuideId] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [health, setHealth] = useState<LibraryHealth | null>(null)
  const [update, setUpdate] = useState<AppUpdateStatus | null>(null)
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNotesStatus | null>(null)
  const [openingUpdate, setOpeningUpdate] = useState(false)
  const [snagitPreview, setSnagitPreview] = useState<SnagitImportPreview | null>(null)
  const [snagitProgress, setSnagitProgress] = useState<SnagitImportProgress | null>(null)
  const [snagitSummary, setSnagitSummary] = useState<SnagitImportSummary | null>(null)
  const [snagitScanning, setSnagitScanning] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const snagitDialogRef = useRef<HTMLElement>(null)
  const snagitImportActive = useRef(false)
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const requestId = useRef(0)
  const guideRequestId = useRef(0)
  const [mainRef, mainSize] = useSize<HTMLElement>()

  const refresh = useCallback(async () => {
    const request = ++requestId.current
    const query = {
      search: search.trim() || undefined,
      kind: filter === 'image' || filter === 'video' ? filter : undefined,
      favorite: filter === 'favorite' || undefined,
      tag: tag ?? undefined
    }
    try {
      const [list, allTags] = await Promise.all([api.library.list(query), api.library.tags()])
      if (request !== requestId.current) return
      setItems(list)
      setSelected((current) => current.filter((id) => list.some((item) => item.id === id)))
      setTags(allTags)
      setLoadError(null)
    } catch (error) {
      if (request !== requestId.current) return
      setLoadError((error as Error).message || 'The Library could not be refreshed')
    } finally {
      if (request === requestId.current) setLoading(false)
    }
  }, [search, filter, tag])

  useEffect(() => {
    void refresh()
    return () => {
      requestId.current++
    }
  }, [refresh])

  useEffect(() => api.library.onChanged(() => void refresh()), [refresh])

  const refreshGuides = useCallback(async () => {
    const request = ++guideRequestId.current
    try {
      const next = await api.guides.list(showGuides ? search : '')
      if (request === guideRequestId.current) setGuides(next)
    } catch (error) {
      if (request === guideRequestId.current)
        toast('error', 'Could not load Guides', (error as Error).message)
    }
  }, [search, showGuides])

  useEffect(() => {
    void refreshGuides()
    return api.guides.onChanged(() => void refreshGuides())
  }, [refreshGuides])

  useEffect(() => api.library.onSnagitProgress(setSnagitProgress), [])

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
    void api.releaseNotes.get().then((status) => {
      if (active) setReleaseNotes(status)
    })
    const unsubscribe = api.releaseNotes.onChanged((status) => {
      if (active) setReleaseNotes(status)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let active = true
    void api.system
      .checkForUpdate()
      .then((status) => {
        if (active) setUpdate(status)
      })
      .catch(() => {
        // Update discovery is intentionally quiet when the public release channel is unavailable.
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

  const openWhatsNew = useCallback(() => {
    api.system.window('settings-whats-new')
  }, [])

  const beginSnagitImport = useCallback(async () => {
    if (snagitScanning || snagitProgress?.state === 'importing') return
    setSnagitScanning(true)
    setSnagitSummary(null)
    setSnagitProgress(null)
    try {
      const preview = await api.library.scanSnagit()
      if (preview) setSnagitPreview(preview)
    } catch (error) {
      toast('error', 'Could not scan the Snagit folder', (error as Error).message)
    } finally {
      setSnagitScanning(false)
    }
  }, [snagitProgress?.state, snagitScanning])

  const importSnagit = useCallback(async () => {
    if (!snagitPreview || snagitProgress?.state === 'importing' || snagitImportActive.current)
      return
    snagitImportActive.current = true
    try {
      const summary = await api.library.importSnagit(snagitPreview.planId)
      setSnagitSummary(summary)
      await refresh()
      if (summary.state === 'completed') {
        toast(
          'success',
          `Imported ${summary.imported} Snagit item${summary.imported === 1 ? '' : 's'}`
        )
      } else {
        toast(
          'info',
          'Snagit import cancelled',
          `${summary.imported} item${summary.imported === 1 ? '' : 's'} imported`
        )
      }
    } catch (error) {
      toast('error', 'Snagit import failed', (error as Error).message)
    } finally {
      snagitImportActive.current = false
    }
  }, [refresh, snagitPreview, snagitProgress?.state])

  const cancelSnagit = useCallback(() => {
    if (snagitPreview) void api.library.cancelSnagit(snagitPreview.planId)
  }, [snagitPreview])

  const closeSnagit = useCallback(() => {
    if (snagitImportActive.current || snagitProgress?.state === 'importing') return
    cancelSnagit()
    setSnagitPreview(null)
    setSnagitSummary(null)
    setSnagitProgress(null)
  }, [cancelSnagit, snagitProgress?.state])

  const importOpen = Boolean(snagitPreview)
  useEffect(() => {
    if (!importOpen) return
    const previousFocus = document.activeElement as HTMLElement | null
    snagitDialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [importOpen])

  useEffect(() => {
    if (importOpen) snagitDialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [importOpen, snagitProgress?.state])

  const active = useMemo(
    () => (selected.length === 1 ? items.find((i) => i.id === selected[0]) : null),
    [items, selected]
  )

  // Captures arrive constantly, so a flat wall of thumbnails stops being navigable fast.
  // Day buckets give the library the shape of a timeline.
  const groups = useMemo(() => groupLibraryItems(items), [items])
  const emptyState = libraryEmptyState(search, filter, tag ?? '')
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
    try {
      const url = api.library.fileUrl(item.filePath)
      const res = await fetch(url)
      if (!res.ok) throw new Error('The original image is missing or could not be read.')
      const blob = await res.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('The image could not be read.'))
        reader.readAsDataURL(blob)
      })
      const ok = await api.exports.copyImage(dataUrl)
      toast(ok ? 'success' : 'error', ok ? 'Copied to clipboard' : 'Copy failed')
    } catch (error) {
      toast('error', 'Could not copy this capture', (error as Error).message)
    }
  }, [])

  /** Move the selection through the grid with the keyboard. */
  const step = useCallback(
    (delta: number) => {
      if (items.length === 0) return
      const current = selected.length
        ? items.findIndex((i) => i.id === selected[selected.length - 1])
        : -1
      const next = Math.max(0, Math.min(items.length - 1, current + delta))
      setSelected([items[next].id])
      requestAnimationFrame(() => cardRefs.current.get(items[next].id)?.focus())
    },
    [items, selected]
  )

  // Match the real responsive grid so up/down navigation remains stable with the inspector open.
  const perRow = view === 'list' ? 1 : libraryGridColumns(mainSize.width)

  useHotkeys({ 'mod+k': () => setPaletteOpen((o) => !o) }, !openGuideId && !importOpen)

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
    !paletteOpen && !showGuides && !openGuideId && !importOpen
  )

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'cap.region',
        title: 'Capture region',
        group: 'Capture',
        icon: 'region',
        run: () => void api.capture.start({ mode: 'region' })
      },
      {
        id: 'cap.window',
        title: 'Capture window',
        group: 'Capture',
        icon: 'window',
        run: () => void api.capture.start({ mode: 'window' })
      },
      {
        id: 'cap.screen',
        title: 'Capture screen',
        group: 'Capture',
        icon: 'monitor',
        run: () => void api.capture.start({ mode: 'display' })
      },
      {
        id: 'cap.scroll',
        title: 'Scrolling capture',
        group: 'Capture',
        icon: 'scroll',
        run: () => void api.capture.start({ mode: 'scrolling' })
      },
      {
        id: 'cap.last-region',
        title: 'Repeat last region',
        group: 'Capture',
        icon: 'region',
        keywords: 'last region repeat recapture',
        run: () => void api.capture.start({ mode: 'lastRegion' })
      },
      {
        id: 'cap.record',
        title: 'Record screen',
        group: 'Capture',
        icon: 'record',
        run: () => api.system.window('record')
      },
      {
        id: 'library.import-snagit',
        title: 'Import Snagit library',
        group: 'Library',
        icon: 'download',
        keywords: 'snagit folder screenshots recordings',
        run: () => void beginSnagitImport()
      },
      {
        id: 'view.all',
        title: 'Show all captures',
        group: 'View',
        icon: 'layers',
        run: () => {
          setShowGuides(false)
          setFilter('all')
          setTag(null)
        }
      },
      {
        id: 'view.images',
        title: 'Show images only',
        group: 'View',
        icon: 'image',
        run: () => {
          setShowGuides(false)
          setFilter('image')
          setTag(null)
        }
      },
      {
        id: 'view.videos',
        title: 'Show recordings only',
        group: 'View',
        icon: 'video',
        run: () => {
          setShowGuides(false)
          setFilter('video')
          setTag(null)
        }
      },
      {
        id: 'view.fav',
        title: 'Show favourites',
        group: 'View',
        icon: 'star',
        run: () => {
          setShowGuides(false)
          setFilter('favorite')
          setTag(null)
        }
      },
      {
        id: 'view.grid',
        title: 'Grid view',
        group: 'View',
        icon: 'grid',
        run: () => setView('grid')
      },
      {
        id: 'view.list',
        title: 'List view',
        group: 'View',
        icon: 'list',
        run: () => setView('list')
      },
      ...tags.map((t) => ({
        id: `tag.${t}`,
        title: `Filter by tag: ${t}`,
        group: 'Tags',
        icon: 'tag' as const,
        run: () => {
          setShowGuides(false)
          setTag(t)
          setFilter('all')
        }
      })),
      {
        id: 'item.open',
        title: 'Open selection',
        group: 'Selection',
        icon: 'pen',
        disabled: !active,
        run: () => {
          if (active) void api.library.open(active.id)
        }
      },
      {
        id: 'item.copy',
        title: 'Copy selection to clipboard',
        group: 'Selection',
        icon: 'copy',
        disabled:
          !active || active.kind !== 'image' || active.workbench.source.state !== 'available',
        run: () => {
          if (active) void copy(active)
        }
      },
      {
        id: 'item.reveal',
        title: 'Reveal in file manager',
        group: 'Selection',
        icon: 'folder',
        disabled: !active,
        run: () => {
          if (active) void api.exports.reveal(active.filePath)
        }
      },
      {
        id: 'item.star',
        title: active?.favorite ? 'Remove from favourites' : 'Add to favourites',
        group: 'Selection',
        icon: 'star',
        disabled: !active,
        run: async () => {
          if (active) {
            await api.library.update(active.id, { favorite: !active.favorite })
            void refresh()
          }
        }
      },
      {
        id: 'item.delete',
        title: 'Delete selection',
        group: 'Selection',
        icon: 'trash',
        disabled: selected.length === 0,
        run: () => void remove()
      },
      {
        id: 'app.settings',
        title: 'Open settings',
        group: 'App',
        icon: 'settings',
        run: () => api.system.window('settings')
      }
    ],
    [active, beginSnagitImport, copy, refresh, remove, selected.length, tags]
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

  const createGuide = async (): Promise<void> => {
    try {
      const guide = await api.guides.create('Untitled guide')
      setOpenGuideId(guide.id)
    } catch (error) {
      toast('error', 'Could not create a guide', (error as Error).message)
    }
  }

  if (openGuideId) {
    return (
      <>
        <GuideWorkspace
          key={openGuideId}
          guideId={openGuideId}
          onBack={() => {
            setOpenGuideId(null)
            setShowGuides(true)
            void refreshGuides()
          }}
          onDeleted={() => {
            setOpenGuideId(null)
            setShowGuides(true)
            void refreshGuides()
          }}
        />
        <ToastHost />
      </>
    )
  }

  return (
    <div className="lib-shell">
      <header className="lib-top drag-region">
        <div className="lib-search no-drag">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            className="lib-search-input"
            placeholder={
              showGuides
                ? 'Search guides and steps…'
                : 'Search titles, tags and text inside captures…'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="btn ghost icon sm"
              aria-label="Clear search"
              onClick={() => setSearch('')}
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
        <div className="spacer" />
        <div className="lib-toolbar no-drag row">
          {!showGuides && (
            <Segmented
              value={view}
              options={[
                { value: 'grid', label: <Icon name="grid" size={13} />, ariaLabel: 'Grid' },
                { value: 'list', label: <Icon name="list" size={13} />, ariaLabel: 'List' }
              ]}
              onChange={setView}
            />
          )}
          {showGuides ? (
            <button className="btn primary lib-toolbar-action" onClick={() => void createGuide()}>
              <Icon name="plus" size={14} /> <span className="lib-action-label">New guide</span>
            </button>
          ) : (
            <>
              <button
                className="btn primary tip lib-toolbar-action lib-primary-action"
                data-tip="Capture region"
                title="Capture region"
                aria-label="Capture region"
                onClick={() => void api.capture.start({ mode: 'region' })}
              >
                <Icon name="region" size={14} /> <span className="lib-action-label">Capture</span>
              </button>
              <button
                className="btn tip lib-toolbar-action lib-primary-action"
                data-tip="Record screen"
                title="Record screen"
                aria-label="Record screen"
                onClick={() => api.system.window('record')}
              >
                <Icon name="record" size={11} /> <span className="lib-action-label">Record</span>
              </button>
              <button
                className="btn ghost tip lib-toolbar-action lib-import-action"
                data-tip={snagitScanning ? 'Scanning Snagit library' : 'Import Snagit library'}
                title={snagitScanning ? 'Scanning Snagit library' : 'Import Snagit library'}
                aria-label={snagitScanning ? 'Scanning Snagit library' : 'Import Snagit library'}
                onClick={() => void beginSnagitImport()}
                disabled={snagitScanning}
              >
                <Icon name="download" size={14} />
                <span className="lib-action-label">
                  {snagitScanning ? 'Scanning…' : 'Import Snagit'}
                </span>
              </button>
            </>
          )}
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
          {releaseNotes?.unread && (
            <button
              className="btn ghost icon tip focus-ring lib-whats-new"
              data-tip={`What's New in ClipThat ${releaseNotes.currentVersion}`}
              title={`What's New in ClipThat ${releaseNotes.currentVersion}`}
              aria-label={`What's New in ClipThat ${releaseNotes.currentVersion}`}
              onClick={openWhatsNew}
            >
              <Icon name="sparkles" />
            </button>
          )}
          <button
            className="btn ghost icon tip align-end focus-ring"
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

      <div className={`lib-body ${active ? 'has-details' : ''}`}>
        <nav className="lib-side" aria-label="Library collections">
          <div className="lib-side-group">
            <button
              className={`lib-nav ${showGuides ? 'active' : ''}`}
              aria-current={showGuides ? 'page' : undefined}
              onClick={() => {
                setShowGuides(true)
                setSelected([])
                setTag(null)
              }}
            >
              <Icon name="step" size={15} /> Guides
            </button>
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
                className={`lib-nav ${!showGuides && filter === key && !tag ? 'active' : ''}`}
                aria-current={!showGuides && filter === key && !tag ? 'page' : undefined}
                onClick={() => {
                  setShowGuides(false)
                  setFilter(key)
                  setTag(null)
                }}
              >
                <Icon name={icon} size={15} />
                {label}
              </button>
            ))}
          </div>

          {!showGuides && tags.length > 0 && (
            <>
              <div className="label" style={{ padding: '14px 12px 6px' }}>
                Tags
              </div>
              <div className="lib-side-group">
                {tags.map((t) => (
                  <button
                    key={t}
                    className={`lib-nav ${tag === t ? 'active' : ''}`}
                    aria-current={tag === t ? 'page' : undefined}
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
            {showGuides ? (
              `${guides.length} guide${guides.length === 1 ? '' : 's'}`
            ) : (
              <>
                {items.length} item{items.length === 1 ? '' : 's'}
                <br />
                {formatBytes(items.reduce((sum, i) => sum + i.byteSize, 0))}
              </>
            )}
          </div>
        </nav>

        <main
          ref={mainRef}
          className={`lib-main ${view}`}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected([])
          }}
        >
          {loadError && (
            <div className="lib-load-error" role="alert">
              <Icon name="alert" size={15} />
              <span>Could not refresh the Library: {loadError}</span>
              <button className="btn ghost sm" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {showGuides ? (
            guides.length === 0 ? (
              <div className="empty">
                <Icon name="step" size={32} />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--ink-1)' }}>
                    {search ? 'No guides matched that search' : 'Build your first guide'}
                  </div>
                  <div className="tiny">
                    Turn screenshots into a polished, local step-by-step guide.
                  </div>
                </div>
                {!search && (
                  <button className="btn primary" onClick={() => void createGuide()}>
                    <Icon name="plus" size={14} /> New guide
                  </button>
                )}
              </div>
            ) : (
              <div className="guide-library-grid">
                {guides.map((guide) => (
                  <button
                    key={guide.id}
                    className="guide-library-card"
                    onClick={() => setOpenGuideId(guide.id)}
                  >
                    <div className="guide-library-thumb">
                      {guide.thumbnail ? (
                        <img src={guide.thumbnail} alt="" />
                      ) : (
                        <Icon name="step" size={28} />
                      )}
                    </div>
                    <strong className="truncate">{guide.title}</strong>
                    <span>
                      {guide.stepCount} step{guide.stepCount === 1 ? '' : 's'} ·{' '}
                      {formatRelative(guide.updatedAt)}
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : loading && items.length === 0 ? (
            <div className="lib-loading" role="status" aria-live="polite">
              <span className="lib-loading-dot" /> Loading Library…
            </div>
          ) : items.length === 0 ? (
            <div className="empty">
              <Icon name="image" size={32} />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--ink-1)' }}>{emptyState.title}</div>
                <div className="tiny">{emptyState.detail}</div>
              </div>
              {!search && filter === 'all' && !tag && (
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
                    cardRef={(node) => {
                      if (node) cardRefs.current.set(item.id, node)
                      else cardRefs.current.delete(item.id)
                    }}
                    onSelect={(e) => toggleSelect(item.id, e)}
                    onFocus={(event) => {
                      if (event.currentTarget.matches(':focus-visible')) setSelected([item.id])
                    }}
                    onOpen={() => void api.library.open(item.id)}
                  />
                ))}
              </React.Fragment>
            ))
          )}
        </main>

        {!showGuides && active && (
          <Details
            key={active.id}
            item={active}
            onCopy={() => void copy(active)}
            onDelete={() => void remove()}
            onChanged={refresh}
            onOpenItem={(id) => void api.library.open(id)}
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

      {snagitPreview && (
        <div className="snagit-scrim" role="presentation">
          <section
            ref={snagitDialogRef}
            className="snagit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="snagit-title"
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                event.preventDefault()
                closeSnagit()
              }
              if (event.key !== 'Tab') return
              const controls =
                event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
              const first = controls[0],
                last = controls[controls.length - 1]
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last?.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first?.focus()
              }
            }}
          >
            <div className="row">
              <div>
                <h2 id="snagit-title">
                  {snagitSummary
                    ? snagitSummary.state === 'cancelled'
                      ? 'Snagit import cancelled'
                      : 'Snagit import complete'
                    : 'Import Snagit library'}
                </h2>
                <div className="tiny muted">
                  {snagitPreview.rootName} · source files are never changed
                </div>
              </div>
              <div className="spacer" />
              {!snagitProgress || snagitProgress.state !== 'importing' ? (
                <button
                  className="btn ghost icon"
                  aria-label="Close"
                  onClick={() => {
                    cancelSnagit()
                    setSnagitPreview(null)
                    setSnagitSummary(null)
                    setSnagitProgress(null)
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              ) : null}
            </div>

            {snagitSummary ? (
              <div className="snagit-summary" role="status">
                <div className="snagit-summary-count">{snagitSummary.imported} imported</div>
                <div className="tiny muted">
                  {snagitSummary.failed} failed · {snagitSummary.skipped} duplicates skipped ·{' '}
                  {snagitSummary.nativeProjects} native Snagit project
                  {snagitSummary.nativeProjects === 1 ? '' : 's'} left untouched
                </div>
                <div className="tiny muted">
                  Open or search the Library to find the imported items.
                </div>
              </div>
            ) : snagitProgress?.state === 'importing' ? (
              <div className="snagit-progress" role="status" aria-live="polite">
                <div className="row tiny">
                  <span>Importing {snagitProgress.currentTitle ?? 'files'}…</span>
                  <span className="spacer" />
                  {snagitProgress.percent}%
                </div>
                <div className="snagit-progress-track">
                  <div style={{ width: `${snagitProgress.percent}%` }} />
                </div>
                <div className="tiny muted">
                  {snagitProgress.completed} of {snagitProgress.total} files ·{' '}
                  {snagitProgress.imported} staged · {snagitProgress.failed} failed
                </div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn" onClick={cancelSnagit}>
                    Cancel import
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="snagit-counts">
                  <ImportCount
                    label="Ready to import"
                    value={snagitPreview.counts.supported}
                    detail={formatBytes(snagitPreview.bytes.supported)}
                  />
                  <ImportCount
                    label="Exact duplicates"
                    value={snagitPreview.counts.duplicates}
                    detail={`${formatBytes(snagitPreview.bytes.duplicates)} · skipped`}
                  />
                  <ImportCount
                    label="Native projects"
                    value={snagitPreview.counts.nativeProjects}
                    detail={`${formatBytes(snagitPreview.bytes.nativeProjects)} · export first`}
                  />
                  <ImportCount
                    label="Unsupported"
                    value={snagitPreview.counts.unsupported}
                    detail={`${formatBytes(snagitPreview.bytes.unsupported)} · not copied`}
                  />
                  <ImportCount
                    label="Unreadable"
                    value={snagitPreview.counts.unreadable}
                    detail={`${formatBytes(snagitPreview.bytes.unreadable)} · not copied`}
                  />
                </div>
                <div className="snagit-total tiny muted">
                  {snagitPreview.totalFiles} files · {formatBytes(snagitPreview.totalBytes)} total
                </div>
                {snagitPreview.limitReached && (
                  <div className="snagit-warning tiny">{snagitPreview.limitReached}</div>
                )}
                {snagitPreview.samples.nativeProjects.length > 0 && (
                  <div className="snagit-native-note tiny">
                    Native `.snagx`, `.snag`, and `.snagarchive` files are not editable in ClipThat.
                    Batch-convert or export them from Snagit first.
                  </div>
                )}
                <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      cancelSnagit()
                      setSnagitPreview(null)
                      setSnagitProgress(null)
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn primary"
                    disabled={snagitPreview.importableFiles === 0}
                    onClick={() => void importSnagit()}
                  >
                    <Icon name="download" size={14} /> Import {snagitPreview.importableFiles} item
                    {snagitPreview.importableFiles === 1 ? '' : 's'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <ToastHost />
    </div>
  )
}

function ImportCount(props: { label: string; value: number; detail: string }): React.ReactElement {
  return (
    <div className="snagit-count">
      <strong>{props.value}</strong>
      <span>{props.label}</span>
      <small>{props.detail}</small>
    </div>
  )
}

function Card(props: {
  item: LibraryItemView
  view: 'grid' | 'list'
  selected: boolean
  cardRef: (node: HTMLElement | null) => void
  onSelect: (e: React.MouseEvent) => void
  onFocus: (event: React.FocusEvent<HTMLElement>) => void
  onOpen: () => void
}): React.ReactElement {
  const { item } = props
  const src = item.thumbnail ? api.library.fileUrl(item.thumbnail) : undefined

  return (
    <article
      ref={props.cardRef}
      className={`lib-card ${props.selected ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={props.selected}
      aria-label={`${item.title}, ${item.kind === 'video' ? 'recording' : 'image'}, ${item.workbench.source.label}, ${item.workbench.project.label}, ${item.workbench.export.label}, ${formatRelative(item.createdAt)}`}
      onMouseDown={props.onSelect}
      onDoubleClick={props.onOpen}
      onFocus={props.onFocus}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        props.onOpen()
      }}
      title={item.title}
    >
      <div className="lib-thumb">
        {src ? (
          <img src={src} alt="" loading="lazy" />
        ) : (
          <Icon name={item.kind === 'video' ? 'video' : 'image'} size={26} />
        )}
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
        <div className="lib-card-title truncate">{item.title}</div>
        <div className="tiny muted">
          {formatRelative(item.createdAt)} · {item.width}×{item.height}
        </div>
        <div className="lib-card-status" aria-hidden="true">
          <StatusChip link={item.workbench.source} />
          {item.workbench.project.state !== 'none' && <StatusChip link={item.workbench.project} />}
          {item.workbench.export.state !== 'none' && <StatusChip link={item.workbench.export} />}
        </div>
      </div>
      {props.view === 'list' && (
        <div className="lib-list-facts">
          <span>{item.kind === 'video' ? 'Recording' : 'Image capture'}</span>
          <span>{formatBytes(item.byteSize)}</span>
          <span>{new Date(item.createdAt).toLocaleDateString()}</span>
          <span className="truncate">
            {item.tags.length
              ? item.tags.slice(0, 2).join(', ')
              : item.favorite
                ? 'Favourite'
                : 'Untagged'}
          </span>
        </div>
      )}
    </article>
  )
}

function Details(props: {
  item: LibraryItemView
  onCopy: () => void
  onDelete: () => void
  onChanged: () => void
  onOpenItem: (id: string) => void
}): React.ReactElement {
  const { item } = props
  const [title, setTitle] = useState(item.title)
  const [tagDraft, setTagDraft] = useState('')
  const tagSaving = useRef(false)

  useEffect(() => setTitle(item.title), [item.id, item.title])

  const src = item.thumbnail ? api.library.fileUrl(item.thumbnail) : undefined
  const videoSrc = item.kind === 'video' ? api.library.fileUrl(item.filePath) : undefined

  const commitTitle = async () => {
    if (!title.trim()) {
      setTitle(item.title)
      return
    }
    if (title.trim() !== item.title) {
      try {
        await api.library.update(item.id, { title: title.trim() })
        props.onChanged()
      } catch (error) {
        toast('error', 'Could not rename the capture', (error as Error).message)
      }
    }
  }

  const addTag = async () => {
    const value = tagDraft.trim()
    if (!value || tagSaving.current) return
    if (item.tags.includes(value)) {
      setTagDraft('')
      return
    }
    tagSaving.current = true
    try {
      await api.library.update(item.id, { tags: [...item.tags, value] })
      setTagDraft('')
      props.onChanged()
    } catch (error) {
      toast('error', 'Could not add the tag', (error as Error).message)
    } finally {
      tagSaving.current = false
    }
  }

  return (
    <aside className="lib-details" aria-label="Capture details">
      <div className="lib-preview">
        {videoSrc ? (
          <video src={videoSrc} crossOrigin="anonymous" controls preload="metadata" />
        ) : src ? (
          <img src={src} alt="" />
        ) : (
          <Icon name="image" size={30} />
        )}
      </div>

      <input
        className="field"
        aria-label="Capture title"
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

      <section className="lib-workbench" aria-label="Capture relationships">
        <div className="lib-section-label">Files and versions</div>
        <RelationshipRow
          label="Source"
          link={item.workbench.source}
          action={
            item.workbench.source.itemId && item.workbench.source.state === 'available' ? (
              <button
                className="btn ghost sm"
                onClick={() => props.onOpenItem(item.workbench.source.itemId!)}
                title={`Open ${item.workbench.source.title ?? 'the source recording'}`}
              >
                Open
              </button>
            ) : undefined
          }
        />
        <RelationshipRow label="Project" link={item.workbench.project} />
        <RelationshipRow
          label="Export"
          link={item.workbench.export}
          action={
            item.workbench.export.state === 'available' && item.exportPath ? (
              <button
                className="btn ghost sm"
                onClick={() => void api.exports.reveal(item.exportPath!)}
                title="Reveal the linked export"
              >
                Reveal
              </button>
            ) : undefined
          }
        />
        {item.workbench.derived.length > 0 && (
          <div className="lib-derived-links" aria-label="Derived exports">
            <div className="lib-section-label">Derived exports</div>
            {item.workbench.derived.map((link) => (
              <RelationshipRow
                key={link.itemId}
                label="Version"
                link={link}
                action={
                  link.state === 'available' ? (
                    <button
                      className="btn ghost sm"
                      onClick={() => props.onOpenItem(link.itemId!)}
                      title={`Open ${link.title ?? 'derived export'}`}
                    >
                      Open
                    </button>
                  ) : undefined
                }
              />
            ))}
          </div>
        )}
        {item.workbench.source.state !== 'available' && (
          <div className="lib-recovery-note tiny" role="status">
            <Icon name="alert" size={13} />
            {item.workbench.source.state === 'missing'
              ? 'The original capture is missing or moved. Metadata remains available for recovery.'
              : item.workbench.source.state === 'incomplete'
                ? 'The capture is incomplete, but the original record is preserved for recovery.'
                : 'The original capture could not be read. Keep this record while you recover the file.'}
          </div>
        )}
      </section>

      <div className="lib-tags">
        {item.tags.map((t) => (
          <span key={t} className="lib-tag">
            {t}
            <button
              aria-label={`Remove tag ${t}`}
              onClick={async () => {
                try {
                  await api.library.update(item.id, { tags: item.tags.filter((x) => x !== t) })
                  props.onChanged()
                } catch (error) {
                  toast('error', 'Could not remove the tag', (error as Error).message)
                }
              }}
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        ))}
        <input
          className="lib-tag-input"
          placeholder="Add tag…"
          aria-label="Add a tag"
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
        <button
          className="btn"
          onClick={() => void api.library.open(item.id)}
          title={
            item.workbench.project.state === 'missing' ||
            item.workbench.project.state === 'unreadable'
              ? 'Open the capture; the linked project needs recovery'
              : 'Open in the editor'
          }
        >
          <Icon name={item.kind === 'video' ? 'play' : 'pen'} size={14} />
          {item.kind === 'video' ? 'Edit video' : 'Edit'}
        </button>
        <button
          className="btn"
          onClick={props.onCopy}
          disabled={item.kind !== 'image' || item.workbench.source.state !== 'available'}
          title={item.kind !== 'image' ? 'Image copying is available for screenshots' : undefined}
        >
          <Icon name="copy" size={14} /> Copy
        </button>
        <button
          className="btn"
          onClick={async () => {
            try {
              await api.library.update(item.id, { favorite: !item.favorite })
              props.onChanged()
            } catch (error) {
              toast('error', 'Could not update favourites', (error as Error).message)
            }
          }}
          aria-pressed={item.favorite}
        >
          <Icon name="star" size={14} /> {item.favorite ? 'Unstar' : 'Star'}
        </button>
        <button
          className="btn"
          onClick={() => void api.exports.reveal(item.filePath)}
          disabled={item.workbench.source.state !== 'available'}
          title={
            item.workbench.source.state === 'available'
              ? 'Reveal the original capture'
              : 'The original capture is not currently available'
          }
        >
          <Icon name="folder" size={14} /> Reveal
        </button>
        <button className="btn danger" onClick={props.onDelete}>
          <Icon name="trash" size={14} /> Delete
        </button>
      </div>
    </aside>
  )
}

function StatusChip(props: { link: { state: string; label: string } }): React.ReactElement {
  const tone =
    props.link.state === 'missing' ||
    props.link.state === 'unreadable' ||
    props.link.state === 'incomplete'
      ? 'problem'
      : props.link.state
  return (
    <span className={`lib-status-chip ${tone}`} title={props.link.label}>
      <span className="lib-status-dot" />
      {props.link.label}
    </span>
  )
}

function RelationshipRow(props: {
  label: string
  link: { state: string; label: string }
  action?: React.ReactNode
}): React.ReactElement {
  const tone =
    props.link.state === 'missing' ||
    props.link.state === 'unreadable' ||
    props.link.state === 'incomplete'
      ? 'problem'
      : props.link.state
  return (
    <div className="lib-relationship-row">
      <span className="muted">{props.label}</span>
      <span className={`lib-relationship-status ${tone}`}>
        <span className="lib-status-dot" />
        {props.link.label}
      </span>
      {props.action}
    </div>
  )
}
