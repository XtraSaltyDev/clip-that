import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { releaseNotesStateFile } from './paths'

interface PersistedReleaseNotesState {
  lastSeenVersion: string | null
}

const EMPTY_STATE: PersistedReleaseNotesState = { lastSeenVersion: null }

class ReleaseNotesStore {
  private data: PersistedReleaseNotesState | null = null

  lastSeenVersion(): string | null {
    if (!this.data) this.data = this.load()
    return this.data.lastSeenVersion
  }

  markSeen(version: string): void {
    this.data = { lastSeenVersion: version }
    const target = releaseNotesStateFile()
    const temporary = `${target}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(temporary, target)
    } catch (error) {
      console.error('[release-notes] state write failed', error)
    }
  }

  private load(): PersistedReleaseNotesState {
    try {
      const value = JSON.parse(readFileSync(releaseNotesStateFile(), 'utf8')) as {
        lastSeenVersion?: unknown
      }
      return typeof value.lastSeenVersion === 'string'
        ? { lastSeenVersion: value.lastSeenVersion }
        : EMPTY_STATE
    } catch {
      return EMPTY_STATE
    }
  }
}

export const releaseNotesStore = new ReleaseNotesStore()
