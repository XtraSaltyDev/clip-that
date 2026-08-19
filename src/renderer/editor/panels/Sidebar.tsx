import React from 'react'
import { Icon } from '../../shared/icons'
import { useEditor } from '../store'
import Inspector from './Inspector'
import ContextPanel from './ContextPanel'
import LayersPanel from './LayersPanel'

const TABS = [
  { id: 'inspect', label: 'Style', icon: 'settings' },
  { id: 'context', label: 'Context', icon: 'sparkles' },
  { id: 'layers', label: 'Layers', icon: 'layers' }
] as const

export default function Sidebar({
  image,
  collapsed,
  onCollapsedChange
}: {
  image: HTMLImageElement | null
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}): React.ReactElement {
  const panel = useEditor((s) => s.panel)
  const setPanel = useEditor((s) => s.setPanel)
  const shapeCount = useEditor((s) => s.doc?.shapes.length ?? 0)
  const ocrBusy = useEditor((s) => s.ocrBusy)

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Editor inspector">
      {collapsed ? (
        <button
          className="sidebar-expand"
          aria-label={`Show ${TABS.find((tab) => tab.id === panel)?.label ?? 'editor'} inspector`}
          aria-expanded="false"
          onClick={() => onCollapsedChange(false)}
        >
          <Icon name="chevronLeft" size={14} />
          <Icon name={TABS.find((tab) => tab.id === panel)?.icon ?? 'settings'} size={16} />
          <span>{TABS.find((tab) => tab.id === panel)?.label ?? 'Inspector'}</span>
        </button>
      ) : (
        <>
          <nav className="sidebar-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={panel === t.id ? 'active' : ''}
                data-tip={t.id === 'context' ? 'Screen context' : undefined}
                onClick={() => setPanel(t.id)}
              >
                <Icon
                  name={t.icon}
                  size={13}
                  className={t.id === 'context' && ocrBusy ? 'spin' : undefined}
                />
                {t.label}
                {t.id === 'layers' && shapeCount > 0 && (
                  <span className="tab-count">{shapeCount}</span>
                )}
              </button>
            ))}
            <button
              className="sidebar-collapse"
              aria-label="Collapse inspector"
              aria-expanded="true"
              onClick={() => onCollapsedChange(true)}
            >
              <Icon name="chevronRight" size={13} />
            </button>
          </nav>

          <div className="sidebar-body">
            {panel === 'inspect' && <Inspector />}
            {panel === 'context' && <ContextPanel image={image} />}
            {panel === 'layers' && <LayersPanel />}
          </div>
        </>
      )}
    </aside>
  )
}
