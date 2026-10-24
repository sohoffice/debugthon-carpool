import { describe, expect, it } from 'vitest'
import {
  afterSend,
  DEPART,
  DRIVER_STEPS,
  driverStep,
  ENDED,
  FIRST_REQUEST_DELAY_MS,
  INITIAL_SENDER,
  nextSender,
  NEXT_REQUEST_DELAY_MS,
  PICKUP,
  REQUEST,
  WAITING,
  type DriverTourState,
  type SenderState,
} from './driverSteps'

const idle: DriverTourState = { tripId: null, pending: 0, passengers: [], ended: false }
const driving: DriverTourState = { tripId: 7, pending: 0, passengers: [], ended: false }

describe('driverStep (T69: the coach bar follows the screen)', () => {
  it('before departing: 出發確認', () => expect(driverStep(idle)).toBe(DEPART))
  it('on the road, nothing yet: 等請求', () => expect(driverStep(driving)).toBe(WAITING))
  it('a request waiting: 有請求', () => expect(driverStep({ ...driving, pending: 1 })).toBe(REQUEST))
  it('a confirmed passenger, not yet on board: 載到乘客', () => expect(driverStep({ ...driving, passengers: [{ boarded: false }] })).toBe(PICKUP))
  it('the passenger on board, before the end: still 載到乘客', () => expect(driverStep({ ...driving, passengers: [{ boarded: true }] })).toBe(PICKUP))
  it('a waiting request comes first, even with a passenger on', () =>
    expect(driverStep({ ...driving, pending: 1, passengers: [{ boarded: true }] })).toBe(REQUEST))
  it('the trip ended at its destination: 行程結束', () => expect(driverStep({ ...idle, ended: true })).toBe(ENDED))
})

describe('DRIVER_STEPS', () => {
  it('five steps, numbered in order', () => {
    expect(DRIVER_STEPS.map((s) => [s.index, s.total])).toEqual([0, 1, 2, 3, 4].map((i) => [i, 5]))
  })
  it('only the last offers the passenger tour', () => {
    expect(DRIVER_STEPS.slice(0, -1).every((s) => s.switchTo === undefined)).toBe(true)
    expect(DRIVER_STEPS[ENDED].switchTo).toEqual({ label: '換成乘客體驗', href: '../passenger/index.html' })
  })
})

/** Runs nextSender over a timeline of [ms since the start, state], returning when it sent. */
function sends(timeline: [number, DriverTourState][]): number[] {
  let state: SenderState = INITIAL_SENDER
  const at: number[] = []
  for (const [t, s] of timeline) {
    const next = nextSender(state, s, t)
    state = next.state
    if (next.send) at.push(t)
  }
  return at
}

describe('nextSender (DD-46: the simulated passenger asks, and asks again after a decline)', () => {
  it('nothing before departing', () => expect(sends([[0, idle], [10_000, idle]])).toEqual([]))

  it(`first request ${FIRST_REQUEST_DELAY_MS} ms after departing, not before`, () => {
    expect(sends([[0, driving], [FIRST_REQUEST_DELAY_MS - 1, driving]])).toEqual([])
    expect(sends([[0, driving], [FIRST_REQUEST_DELAY_MS, driving]])).toEqual([FIRST_REQUEST_DELAY_MS])
  })

  it('the delay counts from departing, not from opening the page', () => {
    expect(sends([[0, idle], [60_000, driving], [60_000 + FIRST_REQUEST_DELAY_MS - 1, driving]])).toEqual([])
  })

  it('only one while it waits for the answer', () => {
    const waiting = { ...driving, pending: 1 }
    expect(sends([[0, driving], [4000, driving], [5000, waiting], [10_000, waiting], [20_000, waiting]])).toEqual([4000])
  })

  it('none after it is confirmed', () => {
    const on = { ...driving, passengers: [{ boarded: false }] }
    expect(sends([[0, driving], [4000, driving], [5000, { ...driving, pending: 1 }], [6000, on], [30_000, on]])).toEqual([4000])
  })

  it(`after a decline, the next ${NEXT_REQUEST_DELAY_MS} ms later, not before`, () => {
    const timeline: [number, DriverTourState][] = [[0, driving], [4000, driving], [5000, { ...driving, pending: 1 }], [6000, driving]]
    expect(sends([...timeline, [6000 + NEXT_REQUEST_DELAY_MS - 1, driving]])).toEqual([4000])
    expect(sends([...timeline, [6000 + NEXT_REQUEST_DELAY_MS, driving]])).toEqual([4000, 6000 + NEXT_REQUEST_DELAY_MS])
  })

  it('does not take a request not yet seen for a decline', () => {
    expect(sends([[0, driving], [4000, driving], [5000, driving], [9000, driving], [20_000, driving]])).toEqual([4000])
  })

  it('a new trip starts again from the first delay', () => {
    expect(sends([[0, driving], [4000, driving], [5000, idle], [6000, { ...driving, tripId: 8 }], [6000 + FIRST_REQUEST_DELAY_MS, { ...driving, tripId: 8 }]])).toEqual([
      4000,
      6000 + FIRST_REQUEST_DELAY_MS,
    ])
  })
})

describe('afterSend (T69 review: a send that fails or goes elsewhere is tried again)', () => {
  /** nextSender, then afterSend with the send's outcome, as driverTour's act() does. */
  function run(timeline: [number, DriverTourState][], outcomes: ('waiting' | 'elsewhere' | 'failed')[]): number[] {
    let state: SenderState = INITIAL_SENDER
    const at: number[] = []
    for (const [t, s] of timeline) {
      const next = nextSender(state, s, t)
      state = next.state
      if (next.send) {
        state = afterSend(state, outcomes[at.length] ?? 'waiting')
        at.push(t)
      }
    }
    return at
  }

  it(`a failed first send is tried again ${NEXT_REQUEST_DELAY_MS} ms later, not stuck`, () => {
    expect(run([[0, driving], [4000, driving], [4500, driving], [4500 + NEXT_REQUEST_DELAY_MS, driving]], ['failed'])).toEqual([4000, 4500 + NEXT_REQUEST_DELAY_MS])
  })

  it('not again sooner than the delay, so a lasting error does not flood the backend', () => {
    expect(run([[0, driving], [4000, driving], [4500, driving], [4500 + NEXT_REQUEST_DELAY_MS - 1, driving]], ['failed'])).toEqual([4000])
  })

  it('a request that went to another car (or no car) is tried again too', () => {
    expect(run([[0, driving], [4000, driving], [4500, driving], [4500 + NEXT_REQUEST_DELAY_MS, driving]], ['elsewhere'])).toEqual([4000, 4500 + NEXT_REQUEST_DELAY_MS])
  })

  it('a request waiting for driver4 is not sent again before it shows', () => {
    expect(run([[0, driving], [4000, driving], [4500, driving], [20_000, driving]], ['waiting'])).toEqual([4000])
  })

  it('a failed send after a decline is tried again as well', () => {
    const timeline: [number, DriverTourState][] = [[0, driving], [4000, driving], [4500, { ...driving, pending: 1 }], [5000, driving], [8000, driving], [8500, driving], [11_500, driving]]
    expect(run(timeline, ['waiting', 'failed'])).toEqual([4000, 8000, 11_500])
  })
})
