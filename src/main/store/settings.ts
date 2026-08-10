import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import type { Settings } from '@shared/types'
import { defaultSettings, migrateAfterCapturePreference } from '@shared/defaults'
import { defaultSaveDirectory, settingsFile } from './paths'

class SettingsStore extends EventEmitter {
  private data: Settings | null = null
  private writeTimer: NodeJS.Timeout | null = null

  get(): Settings {
    if (!this.data) this.data = this.load()
    return this.data
  }

  /** Shallow-merge a patch; nested objects are merged one level deep so partial
   *  `{ hotkeys: { grabText } }` updates don't wipe the rest of the group. */
  set(patch: Partial<Settings>): Settings {
    const current = this.get()
    const next = { ...current } as unknown as Record<string, unknown>
    const base = current as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(patch)) {
      const existing = base[key]
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        existing &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        next[key] = { ...(existing as object), ...(value as object) }
      } else {
        next[key] = value
      }
    }
    this.data = next as unknown as Settings
    // Most settings are changed as individual user actions. Persist those immediately so
    // a crash cannot lose a hotkey, save destination, filename rule, or capture preference.
    // Canvas presets are the exception: sliders can emit many updates per second, so retain
    // the debounce for that nested object.
    if (Object.keys(patch).every((key) => key === 'canvasPreset')) this.scheduleWrite()
    else this.flush()
    this.emit('changed', this.data)
    return this.data
  }

  reset(): Settings {
    this.data = defaultSettings(defaultSaveDirectory())
    this.flush()
    this.emit('changed', this.data)
    return this.data
  }

  private load(): Settings {
    const base = defaultSettings(defaultSaveDirectory())
    try {
      const raw = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<Settings>
      return {
        ...base,
        ...raw,
        afterCapture: migrateAfterCapturePreference(raw.afterCapture) ?? base.afterCapture,
        hotkeys: { ...base.hotkeys, ...(raw.hotkeys ?? {}) },
        recording: { ...base.recording, ...(raw.recording ?? {}) },
        canvasPreset: { ...base.canvasPreset, ...(raw.canvasPreset ?? {}) },
        pipeline: { ...base.pipeline, ...(raw.pipeline ?? {}) }
      }
    } catch {
      return base
    }
  }

  /** Debounced atomic write — settings change on every slider drag. */
  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    if (!this.data) return
    const target = settingsFile()
    const tmp = `${target}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, target)
    } catch (err) {
      console.error('[settings] write failed', err)
    }
  }
}

export const settings = new SettingsStore()
