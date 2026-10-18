import { useEffect, useRef, useState } from 'react'

export interface PollingState<T> {
  data: T | undefined
  error: Error | undefined
}

/**
 * Calls `fetcher` now and every `intervalMs` (DD-03: clients poll, no push).
 * Keeps the last good data when a poll fails, so the screen does not flicker.
 * Pass `enabled: false` to pause.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  enabled = true,
): PollingState<T> {
  const [state, setState] = useState<PollingState<T>>({ data: undefined, error: undefined })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function tick() {
      try {
        const data = await fetcherRef.current()
        if (!cancelled) setState({ data, error: undefined })
      } catch (err) {
        if (!cancelled) {
          const error = err instanceof Error ? err : new Error(String(err))
          setState((prev) => ({ data: prev.data, error }))
        }
      }
      // Schedule after the call finishes so slow responses never overlap.
      if (!cancelled) timer = setTimeout(tick, intervalMs)
    }

    tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [intervalMs, enabled])

  return state
}
