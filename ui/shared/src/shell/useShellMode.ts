import { useSyncExternalStore } from 'react'
import { getShellMode, type ShellMode } from './shellMode'

const TOUCH_QUERY = '(pointer: coarse)'

// jsdom has no matchMedia; without it the pointer counts as a mouse.
const hasMatchMedia = () => typeof window.matchMedia === 'function'

function subscribe(onChange: () => void) {
  const touch = hasMatchMedia() ? window.matchMedia(TOUCH_QUERY) : null
  window.addEventListener('resize', onChange)
  touch?.addEventListener('change', onChange)
  return () => {
    window.removeEventListener('resize', onChange)
    touch?.removeEventListener('change', onChange)
  }
}

function snapshot(): ShellMode {
  return getShellMode({
    search: window.location.search,
    width: window.innerWidth,
    height: window.innerHeight,
    touch: hasMatchMedia() && window.matchMedia(TOUCH_QUERY).matches,
  })
}

/** Re-evaluates when the window is resized or rotated, or the pointer changes between mouse and finger. */
export function useShellMode(): ShellMode {
  return useSyncExternalStore(subscribe, snapshot)
}
