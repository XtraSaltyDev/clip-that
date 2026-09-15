import type { Hotkeys } from './types'

export interface HotkeyBinding {
  action: keyof Hotkeys
  accelerator: string
}

/** Option changes macOS's typed character; an accelerator still names the keyboard key. */
export function normalizeHotkeyKey(event: {
  key: string
  code: string
  altKey: boolean
  shiftKey: boolean
}): string | null {
  const key = event.key
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null
  const digit = /^Digit([0-9])$/.exec(event.code)
  if (digit && (event.altKey || event.shiftKey)) return digit[1]
  const letter = /^Key([A-Z])$/.exec(event.code)
  if (letter && event.altKey) return letter[1]
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  const named: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Escape',
    Enter: 'Return',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab'
  }
  return named[key] ?? key
}

/**
 * Decide which global shortcuts can bind before talking to the OS. Duplicate
 * accelerators inside ClipThat are conflicts, not silent no-ops.
 */
export function planHotkeyBindings(keys: Hotkeys): {
  bindings: HotkeyBinding[]
  failures: HotkeyBinding[]
} {
  const bindings: HotkeyBinding[] = []
  const failures: HotkeyBinding[] = []
  const claimed = new Set<string>()

  for (const [action, accelerator] of Object.entries(keys) as [keyof Hotkeys, string][]) {
    if (!accelerator) continue
    if (claimed.has(accelerator)) {
      failures.push({ action, accelerator })
      continue
    }
    claimed.add(accelerator)
    bindings.push({ action, accelerator })
  }

  return { bindings, failures }
}
