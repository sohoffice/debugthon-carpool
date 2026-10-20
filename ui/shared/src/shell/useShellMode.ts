import { useSyncExternalStore } from 'react'
import { getShellMode, type ShellMode } from './shellMode'

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

/** Re-evaluates when the browser window crosses the frame breakpoint. */
export function useShellMode(): ShellMode {
  return useSyncExternalStore(subscribe, () => getShellMode(window.location.search, window.innerWidth))
}
