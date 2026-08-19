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
  COMPACT_TOOL_GROUP_LABELS,
  TOOLS,
  TOOL_KEYS
} from '../.cache/test/src/renderer/editor/tools.js'

test('compact tool groups cover every editor tool and shortcut exactly once', () => {
  const tools = TOOLS.flat()
  assert.equal(TOOLS.length, COMPACT_TOOL_GROUP_LABELS.length)
  assert.equal(tools.length, 18)
  assert.equal(new Set(tools.map((tool) => tool.id)).size, tools.length)
  assert.equal(new Set(tools.map((tool) => tool.key)).size, tools.length)
  for (const tool of tools) assert.equal(TOOL_KEYS[tool.key.toLowerCase()], tool.id)
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
