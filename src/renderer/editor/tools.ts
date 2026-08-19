import type { ToolId } from '@shared/types'
import type { IconName } from '../shared/icons'

export interface ToolDef {
  id: ToolId
  icon: IconName
  label: string
  key: string
}

/** Ordered groups used by both the full rail and its compact flyouts. */
export const TOOLS: ToolDef[][] = [
  [
    { id: 'select', icon: 'select', label: 'Select', key: 'V' },
    { id: 'crop', icon: 'crop', label: 'Crop', key: 'C' },
    { id: 'cutOut', icon: 'cutOut', label: 'Cut Out', key: 'J' }
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
  TOOLS.flat().map((tool) => [tool.key.toLowerCase(), tool.id])
)

export const COMPACT_TOOL_GROUP_LABELS = ['Pointer', 'Draw', 'Shape', 'Privacy', 'Focus'] as const
