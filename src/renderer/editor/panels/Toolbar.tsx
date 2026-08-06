import React from 'react'
import type { ToolId } from '@shared/types'
import { Icon, type IconName } from '../../shared/icons'
import { useEditor } from '../store'

interface ToolDef {
  id: ToolId
  icon: IconName
  label: string
  key: string
}

/** Ordered so related tools sit together; every one has a single-key shortcut. */
export const TOOLS: ToolDef[][] = [
  [
    { id: 'select', icon: 'select', label: 'Select', key: 'V' },
    { id: 'crop', icon: 'crop', label: 'Crop', key: 'C' }
  ],
  [
    { id: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
    { id: 'line', icon: 'line', label: 'Line', key: 'L' },
    { id: 'pen', icon: 'pen', label: 'Pen', key: 'P' },
    { id: 'highlighter', icon: 'highlighter', label: 'Highlighter', key: 'H' }
  ],
  [
    { id: 'rect', icon: 'rect', label: 'Rectangle', key: 'R' },
    { id: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
    { id: 'text', icon: 'text', label: 'Text', key: 'T' },
    { id: 'callout', icon: 'callout', label: 'Callout', key: 'Q' },
    { id: 'step', icon: 'step', label: 'Step number', key: 'S' }
  ],
  [
    { id: 'blur', icon: 'blur', label: 'Blur', key: 'U' },
    { id: 'pixelate', icon: 'pixelate', label: 'Pixelate', key: 'X' },
    { id: 'redact', icon: 'redact', label: 'Redact', key: 'K' }
  ],
  [
    { id: 'spotlight', icon: 'spotlight', label: 'Spotlight', key: 'G' },
    { id: 'magnify', icon: 'magnify', label: 'Magnify', key: 'M' },
    { id: 'measure', icon: 'measure', label: 'Measure', key: 'D' }
  ]
]

export const TOOL_KEYS: Record<string, ToolId> = Object.fromEntries(
  TOOLS.flat().map((t) => [t.key.toLowerCase(), t.id])
)

export default function Toolbar(): React.ReactElement {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)

  return (
    <nav className="toolrail">
      {TOOLS.map((group, i) => (
        <React.Fragment key={i}>
          {i > 0 && <div className="toolrail-sep" />}
          {group.map((t) => (
            <button
              key={t.id}
              className={`tool tip right ${tool === t.id ? 'active' : ''}`}
              data-tip={`${t.label}  ·  ${t.key}`}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
            >
              <Icon name={t.icon} size={18} />
            </button>
          ))}
        </React.Fragment>
      ))}
    </nav>
  )
}
