import { globalShortcut } from 'electron'
import type { Hotkeys } from '@shared/types'
import { planHotkeyBindings } from '@shared/hotkey-plan'
import { settings } from './store/settings'
import { performCapture } from './capture/service'
import { showLibraryWindow } from './windows/manager'
import { recording } from './recording/session'

type Action = keyof Hotkeys

const handlers: Record<Action, () => void> = {
  captureRegion: () => void performCapture({ mode: 'region' }),
  captureWindow: () => void performCapture({ mode: 'window' }),
  captureFullscreen: () => void performCapture({ mode: 'display' }),
  captureLastRegion: () => void performCapture({ mode: 'lastRegion' }),
  captureScrolling: () => void performCapture({ mode: 'scrolling' }),
  startRecording: () => emitter.emit('start-recording'),
  stopRecording: () => emitter.emit('stop-recording'),
  openLibrary: () => showLibraryWindow(),
  grabText: () => emitter.emit('grab-text'),
  guideCaptureNext: () => emitter.emit('guide-capture-next')
}

import { EventEmitter } from 'node:events'
export const emitter = new EventEmitter()

const registered = new Set<string>()

/** Accelerators that failed to bind — surfaced in Settings so conflicts aren't silent. */
let failures: Array<{ action: Action; accelerator: string }> = []

export function hotkeyFailures(): Array<{ action: Action; accelerator: string }> {
  return failures
}

export function registerHotkeys(): void {
  unregisterHotkeys()
  const planned = planHotkeyBindings(settings.get().hotkeys)
  failures = [...planned.failures]

  for (const { action, accelerator } of planned.bindings) {
    try {
      const ok = globalShortcut.register(accelerator, () => {
        // Never let a shortcut stack a second capture on top of a running one.
        if (recording.status().state === 'recording' && action !== 'stopRecording') return
        handlers[action]?.()
      })
      if (ok) registered.add(accelerator)
      else failures.push({ action, accelerator })
    } catch {
      failures.push({ action, accelerator })
    }
  }
}

export function unregisterHotkeys(): void {
  for (const key of registered) {
    try {
      globalShortcut.unregister(key)
    } catch {
      /* ignore */
    }
  }
  registered.clear()
}
