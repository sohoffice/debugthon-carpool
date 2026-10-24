// Static site only: runs a role's tour (DD-46). Each tour reads its own state through the public
// API (and the page, where a step is only on screen), maps it to a step with a pure detect(), and
// acts for the other role. The runner only loops and draws the coach bar.
import { mountCoachBar, type CoachStep } from './coachBar.ts'

export const TOUR_INTERVAL_MS = 1000

export interface Tour<S> {
  /** May keep state of its own and look at the page; errors are retried on the next round. */
  read: () => Promise<S>
  /** Pure: which step the state is on, 0-based. */
  detect: (state: S) => number
  steps: CoachStep[]
  /** The other role's moves; called every round with the state and step just seen. */
  act?: (state: S, index: number) => void | Promise<void>
  intervalMs?: number
}

/** Inside the showcase (?embed=1, or any frame): the showcase runs the Demo there, so no tour. */
export function isEmbedded(win: Window = window): boolean {
  if (new URLSearchParams(win.location.search).get('embed') === '1') return true
  try {
    return win.parent !== win
  } catch {
    return true
  }
}

export function runTour<S>({ read, detect, steps, act, intervalMs = TOUR_INTERVAL_MS }: Tour<S>): void {
  if (isEmbedded()) return
  const bar = mountCoachBar()
  bar.show(steps[0])
  let shown = 0

  async function round() {
    try {
      const state = await read()
      const index = detect(state)
      if (index !== shown) {
        shown = index
        bar.show(steps[index])
      }
      await act?.(state, index)
    } catch (err) {
      // The next round tries again; the app shows its own connection note.
      console.warn('static tour:', err)
    } finally {
      setTimeout(() => void round(), intervalMs)
    }
  }
  void round()
}
