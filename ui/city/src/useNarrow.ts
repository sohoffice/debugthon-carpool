import { useSyncExternalStore } from 'react'

/** Below 1024px, the single-column phone layout (T71, T72). */
export const NARROW = '(max-width: 63.99rem)'

// jsdom has no matchMedia; without it the layout is the desktop one.
const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null)

function subscribe(onChange: () => void) {
  const media = query()
  media?.addEventListener('change', onChange)
  return () => media?.removeEventListener('change', onChange)
}

/** True below 1024px; follows a resize or rotation across the breakpoint. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => !!query()?.matches)
}
