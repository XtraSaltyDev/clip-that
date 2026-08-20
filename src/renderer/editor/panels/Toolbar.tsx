import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../shared/icons'
import { useEditor } from '../store'
import { SELECT_TOOL, TOOL_GROUPS, TOOL_KEYS } from '../tools'
import { nextMenuIndex } from '../responsive'

export { TOOL_KEYS }

export default function Toolbar(): React.ReactElement {
  const tool = useEditor((s) => s.tool)
  const hasCutOut = useEditor((s) => Boolean(s.doc?.cutOuts?.length))
  const setTool = useEditor((s) => s.setTool)
  const [openGroup, setOpenGroup] = useState<number | null>(null)
  const railRef = useRef<HTMLElement>(null)
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (openGroup === null) return
    const close = (event: MouseEvent) => {
      if (!railRef.current?.contains(event.target as Node)) setOpenGroup(null)
    }
    window.addEventListener('mousedown', close)
    requestAnimationFrame(() =>
      railRef.current
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
    <nav className="toolrail toolrail-drawers" aria-label="Annotation tools" ref={railRef}>
      <button
        className={`tool tool-select tip right ${tool === SELECT_TOOL.id ? 'active' : ''}`}
        data-tip={`${SELECT_TOOL.label} · ${SELECT_TOOL.description} · ${SELECT_TOOL.key}`}
        aria-label={`${SELECT_TOOL.label}, ${SELECT_TOOL.description} Shortcut ${SELECT_TOOL.key}`}
        aria-pressed={tool === SELECT_TOOL.id}
        onClick={() => {
          setOpenGroup(null)
          setTool(SELECT_TOOL.id)
        }}
      >
        <Icon name={SELECT_TOOL.icon} size={18} />
        <span className="toolgroup-label">{SELECT_TOOL.label}</span>
      </button>

      <div className="toolrail-sep" />

      {TOOL_GROUPS.map((group, groupIndex) => {
        const selected = group.tools.find((item) => item.id === tool)
        const tooltip = `${group.label} · ${group.description}${selected ? ` Current tool: ${selected.label}.` : ''}`
        return (
          <div className="toolgroup-anchor" key={group.id}>
            <button
              ref={(element) => {
                triggerRefs.current[groupIndex] = element
              }}
              className={`toolgroup-trigger tip right ${selected ? 'active' : ''}`}
              data-tip={tooltip}
              aria-label={`${group.label} tools. ${group.description}${selected ? ` Selected ${selected.label}.` : ''}`}
              aria-haspopup="menu"
              aria-expanded={openGroup === groupIndex}
              onClick={() => setOpenGroup(openGroup === groupIndex ? null : groupIndex)}
            >
              <span className="toolgroup-icon">
                <Icon name={group.icon} size={17} />
              </span>
              <span className="toolgroup-label">{group.label}</span>
            </button>
            {openGroup === groupIndex && (
              <div
                className={`toolgroup-menu ${groupIndex >= 3 ? 'align-bottom' : ''}`}
                data-tool-menu={groupIndex}
                role="menu"
                aria-label={`${group.label} tools`}
                onKeyDown={(event) => menuKeys(event, groupIndex)}
              >
                <div className="toolgroup-heading">
                  <strong>{group.label}</strong>
                  <span>{group.description}</span>
                </div>
                {group.tools.map((item) => {
                  const cropUnavailable = item.id === 'crop' && hasCutOut
                  const helper = cropUnavailable
                    ? 'Unavailable after applying Cut Out.'
                    : item.description
                  return (
                    <button
                      key={item.id}
                      role="menuitemradio"
                      aria-checked={tool === item.id}
                      aria-label={`${item.label}. ${helper} Shortcut ${item.key}`}
                      disabled={cropUnavailable}
                      onClick={() => {
                        setTool(item.id)
                        setOpenGroup(null)
                      }}
                    >
                      <Icon name={item.icon} size={17} />
                      <span className="toolgroup-copy">
                        <strong>{item.label}</strong>
                        <small>{helper}</small>
                      </span>
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
  )
}
