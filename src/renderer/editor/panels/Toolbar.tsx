import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../shared/icons'
import { useEditor } from '../store'
import { COMPACT_TOOL_GROUP_LABELS, TOOLS, TOOL_KEYS } from '../tools'
import { nextMenuIndex } from '../responsive'

export { TOOL_KEYS }

export default function Toolbar(): React.ReactElement {
  const tool = useEditor((s) => s.tool)
  const hasCutOut = useEditor((s) => Boolean(s.doc?.cutOuts?.length))
  const setTool = useEditor((s) => s.setTool)
  const [openGroup, setOpenGroup] = useState<number | null>(null)
  const compactRef = useRef<HTMLElement>(null)
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (openGroup === null) return
    const close = (event: MouseEvent) => {
      if (!compactRef.current?.contains(event.target as Node)) setOpenGroup(null)
    }
    window.addEventListener('mousedown', close)
    requestAnimationFrame(() =>
      compactRef.current
        ?.querySelector<HTMLDivElement>(`[data-tool-menu="${openGroup}"]`)
        ?.querySelector<HTMLButtonElement>('button')
        ?.focus()
    )
    return () => window.removeEventListener('mousedown', close)
  }, [openGroup])

  const menuKeys = (event: React.KeyboardEvent<HTMLDivElement>, groupIndex: number) => {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    )
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next = current
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      next = nextMenuIndex(
        current,
        buttons.length,
        event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'
      )
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpenGroup(null)
      requestAnimationFrame(() => triggerRefs.current[groupIndex]?.focus())
      return
    } else return
    event.preventDefault()
    buttons[next]?.focus()
  }

  return (
    <>
      <nav className="toolrail toolrail-expanded" aria-label="Annotation tools">
        {TOOLS.map((group, i) => (
          <React.Fragment key={i}>
            {i > 0 && <div className="toolrail-sep" />}
            {group.map((t) => {
              const cropUnavailable = t.id === 'crop' && hasCutOut
              return (
                <button
                  key={t.id}
                  className={`tool tip right ${tool === t.id ? 'active' : ''}`}
                  data-tip={`${t.label}  ·  ${t.key}${cropUnavailable ? '  ·  unavailable after Cut Out' : ''}`}
                  aria-label={`${t.label}, shortcut ${t.key}`}
                  aria-pressed={tool === t.id}
                  disabled={cropUnavailable}
                  onClick={() => setTool(t.id)}
                >
                  <Icon name={t.icon} size={18} />
                </button>
              )
            })}
          </React.Fragment>
        ))}
      </nav>

      <nav
        className="toolrail toolrail-compact"
        aria-label="Grouped annotation tools"
        ref={compactRef}
      >
        {TOOLS.map((group, groupIndex) => {
          const selected = group.find((item) => item.id === tool)
          const shown = selected ?? group[0]
          const label = selected?.label ?? COMPACT_TOOL_GROUP_LABELS[groupIndex]
          return (
            <div className="toolgroup-anchor" key={COMPACT_TOOL_GROUP_LABELS[groupIndex]}>
              <button
                ref={(element) => {
                  triggerRefs.current[groupIndex] = element
                }}
                className={`toolgroup-trigger ${selected ? 'active' : ''}`}
                aria-label={`${COMPACT_TOOL_GROUP_LABELS[groupIndex]} tools${selected ? `, selected ${selected.label}` : ''}`}
                aria-haspopup="menu"
                aria-expanded={openGroup === groupIndex}
                onClick={() => setOpenGroup(openGroup === groupIndex ? null : groupIndex)}
              >
                <span className="toolgroup-icon">
                  <Icon name={shown.icon} size={17} />
                </span>
                <span className="toolgroup-label">{label}</span>
                <Icon name="chevronRight" size={10} className="toolgroup-chevron" />
              </button>
              {openGroup === groupIndex && (
                <div
                  className="toolgroup-menu"
                  data-tool-menu={groupIndex}
                  role="menu"
                  aria-label={`${COMPACT_TOOL_GROUP_LABELS[groupIndex]} tools`}
                  onKeyDown={(event) => menuKeys(event, groupIndex)}
                >
                  <div className="toolgroup-heading">
                    {COMPACT_TOOL_GROUP_LABELS[groupIndex]} tools
                  </div>
                  {group.map((item) => {
                    const cropUnavailable = item.id === 'crop' && hasCutOut
                    return (
                      <button
                        key={item.id}
                        role="menuitemradio"
                        aria-checked={tool === item.id}
                        disabled={cropUnavailable}
                        onClick={() => {
                          setTool(item.id)
                          setOpenGroup(null)
                        }}
                      >
                        <Icon name={item.icon} size={16} />
                        <span>{item.label}</span>
                        {tool === item.id && <Icon name="check" size={13} />}
                        <span className="kbd">{item.key}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </>
  )
}
