import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** The system "reduce motion" setting; every animation stops when it is on (8.4). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches)
}
