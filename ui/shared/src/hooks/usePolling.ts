import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

export interface PollingState<T> {
  data: T | undefined
  error: Error | undefined
}

export interface Polling<T> extends PollingState<T> {
  /**
   * Shows `data` now, e.g. the response of an action, instead of waiting for the next poll.
   * A poll that was already in flight is ignored, so it cannot bring back the old state.
   */
  mutate: (data: T) => void
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

/** False while the tab is in the background; polling then waits, and catches up on return. */
function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState !== 'hidden')
}

/**
 * Calls `fetcher` now and every `intervalMs` (DD-03: clients poll, no push).
 * Keeps the last good data when a poll fails, so the screen does not flicker.
 * Pauses while the page is hidden and polls at once when it is shown again.
 * Pass `enabled: false` to pause.
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number, enabled = true): Polling<T> {
  const [state, setState] = useState<PollingState<T>>({ data: undefined, error: undefined })
  const visible = usePageVisible()
  const active = enabled && visible
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  // Bumped by mutate(); a poll started under an older generation is dropped.
  const generation = useRef(0)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function tick() {
      const startedAt = generation.current
      try {
        const data = await fetcherRef.current()
        if (!cancelled && startedAt === generation.current) setState({ data, error: undefined })
      } catch (err) {
        if (!cancelled && startedAt === generation.current) {
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
  }, [intervalMs, active])

  const mutate = useCallback((data: T) => {
    generation.current += 1
    setState({ data, error: undefined })
  }, [])

  return { ...state, mutate }
}
