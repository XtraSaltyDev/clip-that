import type { Hotkeys } from './types'

export interface HotkeyBinding {
  action: keyof Hotkeys
  accelerator: string
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
