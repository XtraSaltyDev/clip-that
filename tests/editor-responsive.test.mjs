import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  COMPACT_OVERFLOW_ACTIONS,
  EDITOR_COMPACT_MAX_WIDTH,
  compactEditorQuery,
  inspectorStartsCollapsed,
  nextMenuIndex
} from '../.cache/test/src/renderer/editor/responsive.js'
import {
  ALL_TOOLS,
  SELECT_TOOL,
  TOOL_GROUPS,
  TOOL_KEYS
} from '../.cache/test/src/renderer/editor/tools.js'

test('five tool drawers cover every non-select tool and shortcut exactly once', () => {
  assert.equal(SELECT_TOOL.id, 'select')
  assert.equal(TOOL_GROUPS.length, 5)
  assert.deepEqual(
    TOOL_GROUPS.map((group) => group.label),
    ['Frame', 'Draw', 'Shapes & Focus', 'Explain', 'Protect']
  )
  assert.equal(ALL_TOOLS.length, 18)
  assert.equal(new Set(ALL_TOOLS.map((tool) => tool.id)).size, ALL_TOOLS.length)
  assert.equal(new Set(ALL_TOOLS.map((tool) => tool.key)).size, ALL_TOOLS.length)
  assert.equal(
    TOOL_GROUPS.some((group) => group.tools.some((tool) => tool.id === SELECT_TOOL.id)),
    false
  )
  for (const group of TOOL_GROUPS) {
    assert.ok(group.description.length > 0)
    for (const tool of group.tools) assert.ok(tool.description.length > 0)
  }
  for (const tool of ALL_TOOLS) assert.equal(TOOL_KEYS[tool.key.toLowerCase()], tool.id)
})

test('editor compact breakpoint starts the inspector collapsed only at compact widths', () => {
  assert.equal(compactEditorQuery(), `(max-width: ${EDITOR_COMPACT_MAX_WIDTH}px)`)
  assert.equal(inspectorStartsCollapsed(900), true)
  assert.equal(inspectorStartsCollapsed(EDITOR_COMPACT_MAX_WIDTH), true)
  assert.equal(inspectorStartsCollapsed(EDITOR_COMPACT_MAX_WIDTH + 1), false)
})

test('menu traversal wraps and supports Home and End', () => {
  assert.equal(nextMenuIndex(2, 4, 'ArrowDown'), 3)
  assert.equal(nextMenuIndex(3, 4, 'ArrowDown'), 0)
  assert.equal(nextMenuIndex(0, 4, 'ArrowUp'), 3)
  assert.equal(nextMenuIndex(2, 4, 'Home'), 0)
  assert.equal(nextMenuIndex(1, 4, 'End'), 3)
  assert.equal(nextMenuIndex(0, 0, 'ArrowDown'), -1)
})

test('compact overflow renders every displaced editor action', async () => {
  const source = await readFile('src/renderer/editor/panels/TopBar.tsx', 'utf8')
  for (const action of COMPACT_OVERFLOW_ACTIONS) {
    assert.match(source, new RegExp(`data-overflow-action=["']${action}["']`))
  }
})
