import { FRAME_MIN_TOUCH_VIEWPORT_HEIGHT, FRAME_MIN_VIEWPORT_WIDTH } from './device'

/**
 * phone:  real phone, full screen, the OS draws the status bar.
 * framed: desktop browser, the app draws a phone frame around itself.
 * embed:  inside the showcase page (?embed=1), which draws the frame; the app draws only the screen.
 */
export type ShellMode = 'phone' | 'framed' | 'embed'

export interface ShellViewport {
  search: string
  width: number
  height: number
  /** The primary pointer is a finger (`(pointer: coarse)`), not a mouse or trackpad. */
  touch: boolean
}

/** Decided by screen size and pointer, never by the browser's user agent (UD-13). */
export function getShellMode({ search, width, height, touch }: ShellViewport): ShellMode {
  if (new URLSearchParams(search).get('embed') === '1') return 'embed'
  if (width < FRAME_MIN_VIEWPORT_WIDTH) return 'phone'
  // A phone on its side is wide but short; framing it would shrink the app out of reach (T83).
  if (touch && height < FRAME_MIN_TOUCH_VIEWPORT_HEIGHT) return 'phone'
  return 'framed'
}
