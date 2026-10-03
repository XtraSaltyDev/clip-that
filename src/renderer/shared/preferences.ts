import { useEffect, useState } from 'react'

/** Only surface preferences belong here; document and application data stay main-owned. */
export function useSurfacePreference<T extends string>(
  key: string,
  values: readonly T[],
  fallback: T
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(`clipthat.${key}.v1`)
      return values.includes(saved as T) ? (saved as T) : fallback
    } catch {
      return fallback
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(`clipthat.${key}.v1`, value)
    } catch {
      // Storage can be unavailable; the control still works for this session.
    }
  }, [key, value])
  return [value, setValue] as const
}

export function useDebouncedValue<T>(value: T, delay = 180): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [delay, value])
  return settled
}
