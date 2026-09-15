import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from './helpers.mjs'

const { shouldIncludeWindowSource } = await load('src/main/capture/window-sources.js')
const own = ['window:100:0', 'window:101:0', 'window:102:0']
const editors = ['window:101:0']

test('a browser or document titled ClipThat remains capturable', () => {
  assert.equal(
    shouldIncludeWindowSource('ClipThat acceptance CEDAR-4821', 'window:900:0', own, editors),
    true
  )
  assert.equal(shouldIncludeWindowSource('ClipThat', 'window:901:0', own, []), true)
})

test('internal windows are excluded by ID even if their titles do not identify the app', () => {
  assert.equal(shouldIncludeWindowSource('Record screen', 'window:100:0', own, editors), false)
  assert.equal(shouldIncludeWindowSource('Settings', 'window:102:0', own, editors), false)
  assert.equal(shouldIncludeWindowSource('My capture', 'window:101:0', own, editors), true)
  assert.equal(shouldIncludeWindowSource('My capture', 'window:101:0', own, []), false)
})

test('native IDs match across Electron source suffixes without relying on shared titles', () => {
  assert.equal(shouldIncludeWindowSource('ClipThat', 'window:100:87', own, editors), false)
  assert.equal(shouldIncludeWindowSource('ClipThat', 'window:101:87', own, editors), true)
  assert.equal(shouldIncludeWindowSource('   ', 'window:900:0', own, editors), false)
})
