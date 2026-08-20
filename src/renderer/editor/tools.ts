import type { ToolId } from '@shared/types'
import type { IconName } from '../shared/icons'

export interface ToolDef {
  id: ToolId
  icon: IconName
  label: string
  key: string
  description: string
}

export interface ToolGroupDef {
  id: 'frame' | 'draw' | 'shapes-focus' | 'explain' | 'protect'
  icon: IconName
  label: string
  description: string
  tools: ToolDef[]
}

/** Select stays one click away because it is the editor's primary navigation tool. */
export const SELECT_TOOL: ToolDef = {
  id: 'select',
  icon: 'select',
  label: 'Select',
  key: 'V',
  description: 'Select, move and resize annotations.'
}

/** Five stable drawers keep the rail short while preserving every annotation tool. */
export const TOOL_GROUPS: ToolGroupDef[] = [
  {
    id: 'frame',
    icon: 'crop',
    label: 'Frame',
    description: 'Change the visible image area.',
    tools: [
      {
        id: 'crop',
        icon: 'crop',
        label: 'Crop',
        key: 'C',
        description: 'Keep only the part of the image you need.'
      },
      {
        id: 'cutOut',
        icon: 'cutOut',
        label: 'Cut Out',
        key: 'J',
        description: 'Remove a horizontal or vertical section.'
      }
    ]
  },
  {
    id: 'draw',
    icon: 'pen',
    label: 'Draw',
    description: 'Point to or mark content.',
    tools: [
      {
        id: 'arrow',
        icon: 'arrow',
        label: 'Arrow',
        key: 'A',
        description: 'Point directly at something important.'
      },
      {
        id: 'line',
        icon: 'line',
        label: 'Line',
        key: 'L',
        description: 'Draw a straight line between two points.'
      },
      {
        id: 'pen',
        icon: 'pen',
        label: 'Pen',
        key: 'P',
        description: 'Draw freely on the image.'
      },
      {
        id: 'highlighter',
        icon: 'highlighter',
        label: 'Highlighter',
        key: 'H',
        description: 'Mark an area with a translucent stroke.'
      }
    ]
  },
  {
    id: 'shapes-focus',
    icon: 'rect',
    label: 'Shapes & Focus',
    description: 'Enclose or emphasize an area.',
    tools: [
      {
        id: 'rect',
        icon: 'rect',
        label: 'Rectangle',
        key: 'R',
        description: 'Draw a box around an area.'
      },
      {
        id: 'ellipse',
        icon: 'ellipse',
        label: 'Ellipse',
        key: 'O',
        description: 'Circle an area with an ellipse.'
      },
      {
        id: 'spotlight',
        icon: 'spotlight',
        label: 'Spotlight',
        key: 'G',
        description: 'Dim everything outside the selected area.'
      },
      {
        id: 'magnify',
        icon: 'magnify',
        label: 'Magnify',
        key: 'M',
        description: 'Enlarge an important detail.'
      }
    ]
  },
  {
    id: 'explain',
    icon: 'callout',
    label: 'Explain',
    description: 'Add instructional text and measurements.',
    tools: [
      {
        id: 'text',
        icon: 'text',
        label: 'Text',
        key: 'T',
        description: 'Add a text label.'
      },
      {
        id: 'callout',
        icon: 'callout',
        label: 'Callout',
        key: 'Q',
        description: 'Add text with a pointer.'
      },
      {
        id: 'step',
        icon: 'step',
        label: 'Step number',
        key: 'S',
        description: 'Place automatically numbered markers.'
      },
      {
        id: 'measure',
        icon: 'measure',
        label: 'Measure',
        key: 'D',
        description: 'Show the distance between two points.'
      }
    ]
  },
  {
    id: 'protect',
    icon: 'shield',
    label: 'Protect',
    description: 'Hide sensitive information.',
    tools: [
      {
        id: 'blur',
        icon: 'blur',
        label: 'Blur',
        key: 'U',
        description: 'Soften content so it is harder to read.'
      },
      {
        id: 'pixelate',
        icon: 'pixelate',
        label: 'Pixelate',
        key: 'X',
        description: 'Obscure content with large pixels.'
      },
      {
        id: 'redact',
        icon: 'redact',
        label: 'Redact',
        key: 'K',
        description: 'Cover information with a solid block.'
      }
    ]
  }
]

export const ALL_TOOLS = [SELECT_TOOL, ...TOOL_GROUPS.flatMap((group) => group.tools)]

export const TOOL_KEYS: Record<string, ToolId> = Object.fromEntries(
  ALL_TOOLS.map((tool) => [tool.key.toLowerCase(), tool.id])
)
