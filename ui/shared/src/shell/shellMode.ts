import { FRAME_MIN_VIEWPORT_WIDTH } from './device'

/**
 * phone:  real phone, full screen, the OS draws the status bar.
 * framed: desktop browser, the app draws a phone frame around itself.
 * embed:  inside the showcase page (?embed=1), which draws the frame; the app draws only the screen.
 */
export type ShellMode = 'phone' | 'framed' | 'embed'

export function getShellMode(search: string, viewportWidth: number): ShellMode {
  if (new URLSearchParams(search).get('embed') === '1') return 'embed'
  return viewportWidth >= FRAME_MIN_VIEWPORT_WIDTH ? 'framed' : 'phone'
}
