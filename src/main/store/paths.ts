import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ensure = (dir: string) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** `~/Library/Application Support/ClipThat` and equivalents. */
export const userData = () => ensure(app.getPath('userData'))

/** Where captures live: originals, projects and thumbnails. */
export const libraryDir = () => ensure(join(userData(), 'library'))
export const capturesDir = () => ensure(join(libraryDir(), 'captures'))
export const projectsDir = () => ensure(join(libraryDir(), 'projects'))
export const thumbsDir = () => ensure(join(libraryDir(), 'thumbnails'))
export const recordingsDir = () => ensure(join(libraryDir(), 'recordings'))
export const tempDir = () => ensure(join(userData(), 'tmp'))

export const settingsFile = () => join(userData(), 'settings.json')
export const libraryIndexFile = () => join(libraryDir(), 'index.json')

/** Default place to drop saved images: `~/Pictures/ClipThat`. */
export function defaultSaveDirectory(): string {
  let base: string
  try {
    base = app.getPath('pictures')
  } catch {
    base = app.getPath('home')
  }
  return ensure(join(base, 'ClipThat'))
}
