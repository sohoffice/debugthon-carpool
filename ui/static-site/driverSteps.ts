// The driver tour's steps and decisions, without I/O, so they are unit tested (T69, DD-46).
import type { CoachStep } from './coachBar.ts'

/** What the tour sees each round: the driver's requests, and the last trip it saw running. */
export interface DriverTourState {
  tripId: number | null
  pending: number
  passengers: { boarded: boolean }[]
  /** The last running trip has ended at its destination (DD-30). */
  ended: boolean
}

export const DEPART = 0
export const WAITING = 1
export const REQUEST = 2
export const PICKUP = 3
export const ENDED = 4

const TOTAL = 5
export const DRIVER_STEPS: CoachStep[] = [
  { index: DEPART, total: TOTAL, text: '設定已經填好，按「我出發了」就好' },
  { index: WAITING, total: TOTAL, text: '開往上車點中，幾秒後會有人要搭' },
  { index: REQUEST, total: TOTAL, text: '有人要搭！看一下下車點，按「確認」' },
  { index: PICKUP, total: TOTAL, text: '到上車點了，乘客上車後按「已上車」' },
  {
    index: ENDED,
    total: TOTAL,
    text: '完成！你今天幫園區少了一輛車',
    switchTo: { label: '換成乘客體驗', href: '../passenger/index.html' },
  },
]

/** The step the driver is on: the same screens the app shows (SC-D1, D2, D3, D2 with a passenger, D4). */
export function driverStep(s: DriverTourState): number {
  if (s.tripId === null) return s.ended ? ENDED : DEPART
  if (s.pending > 0) return REQUEST
  if (s.passengers.length > 0) return PICKUP
  return WAITING
}

/** About 4 s after departing, the simulated passenger asks (DD-46). */
export const FIRST_REQUEST_DELAY_MS = 4000
/** After a decline, the next one a few seconds later (DD-46). */
export const NEXT_REQUEST_DELAY_MS = 3000

/** The tour's own memory between rounds: when the trip started, and the requests it has sent. */
export interface SenderState {
  departedAt: number | null
  /** Sent so far on this trip. */
  sent: number
  /** The last one sent has been seen waiting or on board; until then an empty trip is not a decline. */
  seen: boolean
  /** Since when the trip has been empty after the last request was seen: it was declined. */
  emptySince: number | null
}

export const INITIAL_SENDER: SenderState = { departedAt: null, sent: 0, seen: false, emptySince: null }

/**
 * Whether to send a request now: the first FIRST_REQUEST_DELAY_MS after departing, then one more
 * NEXT_REQUEST_DELAY_MS after each decline. Never while one is waiting or a passenger is on.
 */
export function nextSender(prev: SenderState, s: DriverTourState, now: number): { state: SenderState; send: boolean } {
  if (s.tripId === null) return { state: INITIAL_SENDER, send: false }
  const departedAt = prev.departedAt ?? now
  if (s.pending > 0 || s.passengers.length > 0) return { state: { ...prev, departedAt, seen: true, emptySince: null }, send: false }
  if (prev.sent === 0) {
    const send = now - departedAt >= FIRST_REQUEST_DELAY_MS
    return { state: { ...prev, departedAt, sent: send ? 1 : 0 }, send }
  }
  // Sent, but not seen yet: wait for it rather than send another.
  if (!prev.seen) return { state: { ...prev, departedAt }, send: false }
  const emptySince = prev.emptySince ?? now
  const send = now - emptySince >= NEXT_REQUEST_DELAY_MS
  return send
    ? { state: { departedAt, sent: prev.sent + 1, seen: false, emptySince: null }, send }
    : { state: { ...prev, departedAt, emptySince }, send }
}

/** What came of a send: waiting for driver4, decided otherwise (another car, no car), or it threw. */
export type SendOutcome = 'waiting' | 'elsewhere' | 'failed'

/**
 * After a send: only a request waiting for driver4 is waited for. One that failed or went elsewhere
 * counts as seen, so nextSender tries again after NEXT_REQUEST_DELAY_MS instead of waiting forever.
 */
export function afterSend(state: SenderState, outcome: SendOutcome): SenderState {
  return outcome === 'waiting' ? state : { ...state, seen: true }
}
