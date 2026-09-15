import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Icon, type IconName } from './icons'
import { toast } from './ui'
import './palette.css'

export interface Command {
  id: string
  title: string
  hint?: string
  group: string
  icon?: IconName
  shortcut?: string
  /** Extra words that should match this command. */
  keywords?: string
  run: () => void | Promise<void>
  disabled?: boolean
}

/**
 * Fuzzy subsequence match. Returns a score (lower is better) or null.
 * Matches at word starts score much better, so "cr" finds "Crop" before "Recorder".
 */
function fuzzy(query: string, target: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  let score = 0
  let ti = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    const atWordStart = found === 0 || /[\s\-_/]/.test(t[found - 1])
    score += atWordStart ? 0 : found - ti + 1
    ti = found + 1
  }
  return score + (t.length - q.length) * 0.05
}

export default function CommandPalette({
  open,
  commands,
  onClose,
  placeholder = 'Type a command…'
}: {
  open: boolean
  commands: Command[]
  onClose: () => void
  placeholder?: string
}): React.ReactElement | null {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (open) {
      const previousFocus = document.activeElement as HTMLElement | null
      setQuery('')
      setActive(0)
      inputRef.current?.focus()
      return () => {
        if (previousFocus?.isConnected) previousFocus.focus()
      }
    }
  }, [open])

  const results = useMemo(() => {
    const scored = commands
      .filter((c) => !c.disabled)
      .map((c) => {
        const score = fuzzy(query, `${c.title} ${c.keywords ?? ''} ${c.group}`)
        return score === null ? null : { command: c, score }
      })
      .filter((x): x is { command: Command; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40)
    return scored.map((s) => s.command)
  }, [commands, query])

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)))
  }, [results.length])

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector('.cmd-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const run = (command: Command) => {
    onClose()
    void Promise.resolve()
      .then(() => command.run())
      .catch((error) => {
        toast('error', `Could not ${command.title.toLowerCase()}`, (error as Error).message)
      })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Tab') {
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        'input, button:not([tabindex="-1"])'
      )
      const first = controls?.[0]
      const last = controls?.[controls.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % Math.max(1, results.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + results.length) % Math.max(1, results.length))
    } else if (e.key === 'Enter') {
      if (e.target !== inputRef.current) return
      e.preventDefault()
      const command = results[active]
      if (command) run(command)
    }
  }

  let lastGroup = ''

  return (
    <div className="cmd-scrim" onMouseDown={onClose}>
      <div
        className="cmd"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmd-search">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            role="combobox"
            aria-label="Search commands"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
          />
          <button className="btn ghost icon" aria-label="Close command palette" onClick={onClose}>
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="cmd-list" ref={listRef} id={listId} role="listbox" aria-label="Commands">
          {results.length === 0 && (
            <div className="cmd-none" role="status">
              No matching commands. Try a tool or action name.
            </div>
          )}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null
            lastGroup = c.group
            return (
              <React.Fragment key={c.id}>
                {header && <div className="cmd-group">{header}</div>}
                <button
                  id={`${listId}-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  tabIndex={-1}
                  className={`cmd-item ${i === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(c)}
                >
                  <Icon name={c.icon ?? 'chevronRight'} size={15} />
                  <span className="truncate" style={{ flex: 1 }}>
                    {c.title}
                    {c.hint && <span className="cmd-hint"> — {c.hint}</span>}
                  </span>
                  {c.shortcut && <span className="kbd">{c.shortcut}</span>}
                </button>
              </React.Fragment>
            )
          })}
        </div>
        <div className="cmd-footer">
          <span>↑ ↓ Navigate</span>
          <span>Enter Run</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  )
}
