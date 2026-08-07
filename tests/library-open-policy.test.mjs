import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const {
  initialLibraryOpenAction,
  libraryOpenActionFromResponse,
  savedLibraryOpenBehavior
} = await load('libraryOpenPolicy')

test('opens a new editor without prompting when no editor is open', () => {
  assert.equal(initialLibraryOpenAction('ask', false), 'new')
  assert.equal(initialLibraryOpenAction('existing', false), 'new')
})

test('honours the saved choice when an editor is already open', () => {
  assert.equal(initialLibraryOpenAction('ask', true), 'ask')
  assert.equal(initialLibraryOpenAction('existing', true), 'existing')
  assert.equal(initialLibraryOpenAction('new', true), 'new')
})

test('maps the Library prompt buttons to an open action', () => {
  assert.equal(libraryOpenActionFromResponse(0), 'existing')
  assert.equal(libraryOpenActionFromResponse(1), 'new')
  assert.equal(libraryOpenActionFromResponse(2), 'cancel')
})

test('persists only a checked affirmative choice', () => {
  assert.equal(savedLibraryOpenBehavior('existing', true), 'existing')
  assert.equal(savedLibraryOpenBehavior('new', true), 'new')
  assert.equal(savedLibraryOpenBehavior('cancel', true), null)
  assert.equal(savedLibraryOpenBehavior('existing', false), null)
})
