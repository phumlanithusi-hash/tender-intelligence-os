import { useEffect, useState } from 'react'

/**
 * Debounces a fast-changing value (Phase 3 §27: "debounced search").
 * Used so every keystroke in the search field doesn't fire a new
 * /api/tenders request — only once typing pauses.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
