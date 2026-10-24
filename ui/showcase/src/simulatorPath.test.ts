import { distanceM } from '@carpool/shared'
import { describe, expect, it } from 'vitest'
import { SIMULATOR_ROUTES } from './simulatorRoutes'
import { distanceAlong, distanceTravelled, makePath, MAX_REPORTS_PER_TICK, pointAt, REPORT_STEP_M, reportDistances } from './simulatorPath'

const SONGSHAN = { lat: 25.049806, lng: 121.578206 }
const PICKUP_RADIUS_M = 80
/** pass_margin (DD-06): passed once beyond the radius plus this. */
const PASS_MARGIN_M = 25

/** Metres along a path to the pickup point. */
function toPickup(name: string): number {
  const path = makePath(SIMULATOR_ROUTES[name].path)
  const i = path.points.findIndex((p) => distanceM(p, SONGSHAN) < 1)
  return path.cumulative[i]
}

describe('simulator path (T08)', () => {
  it('moves by elapsed time: 30 km/h is about 500 m a minute', () => {
    expect(distanceTravelled(30, 0, 60_000, 10_000)).toBeCloseTo(500, 0)
    expect(distanceTravelled(30, 0, 3_600_000, 10_000)).toBe(10_000)
  })

  it('reports in steps, so a long background pause never skips the pickup area (DD-06)', () => {
    const path = makePath(SIMULATOR_ROUTES.driver4.path)
    // One throttled tick a minute in a background tab.
    const steps = reportDistances(0, distanceTravelled(25, 0, 5 * 60_000, path.length))
    const gaps = steps.slice(1).map((d, i) => d - steps[i])
    expect(Math.max(...gaps)).toBeLessThanOrEqual(REPORT_STEP_M)
    expect(steps.some((d) => distanceM(pointAt(path, d), SONGSHAN) <= PICKUP_RADIUS_M)).toBe(true)
    expect(steps.length).toBeLessThanOrEqual(MAX_REPORTS_PER_TICK)
  })

  it('every demo driver passes the pickup point and ends at its destination', () => {
    for (const [name, route] of Object.entries(SIMULATOR_ROUTES)) {
      const path = makePath(route.path)
      const passes = path.points.some((p) => distanceM(p, SONGSHAN) < 1)
      expect(passes, name).toBe(true)
      expect(pointAt(path, path.length + 100)).toEqual(path.points.at(-1))
    }
  })

  it('driver5 starts nearer the pickup than driver4, so it gets the request first (DD-45)', () => {
    expect(toPickup('driver5')).toBeCloseTo(400, -1)
    expect(toPickup('driver5')).toBeLessThan(toPickup('driver4'))
  })

  it('driver4 and driver5 wait for a request; driver1-3 drive from departure (T63, DD-45)', () => {
    expect(SIMULATOR_ROUTES.driver4.holdUntilRequest).toBe(true)
    expect(SIMULATOR_ROUTES.driver5.holdUntilRequest).toBe(true)
    for (const name of ['driver1', 'driver2', 'driver3']) {
      expect(SIMULATOR_ROUTES[name].holdUntilRequest, name).toBeFalsy()
      expect(SIMULATOR_ROUTES[name].fastForward, name).toBeUndefined()
    }
  })

  it("driver4's fast-forward passes the pickup within about 4 s of 確認 (T64, DD-06)", () => {
    const fast = SIMULATOR_ROUTES.driver4.fastForward!
    const passAt = toPickup('driver4') + PICKUP_RADIUS_M + PASS_MARGIN_M
    expect(fast.untilM).toBeGreaterThan(passAt)
    // Even from the path start, within one 1 s tick: the other ~2 s are the simulator's and the passenger UI's polls.
    expect(fast.untilM / (fast.speedKmh / 3.6)).toBeLessThanOrEqual(1)
    // And within one tick's report cap at 20 m a report.
    expect(Math.ceil(fast.untilM / REPORT_STEP_M)).toBeLessThan(MAX_REPORTS_PER_TICK)
  })

  it("driver4's fast-forward from boarding reaches the destination in about 4 s; only driver4 has one (T64)", () => {
    const path = makePath(SIMULATOR_ROUTES.driver4.path)
    const { speedKmh } = SIMULATOR_ROUTES.driver4.fastToEnd!
    const rest = path.length - SIMULATOR_ROUTES.driver4.fastForward!.untilM
    // About 4 s of driving; the two 1 s polls make it about 6 s on the phones.
    expect(rest / (speedKmh / 3.6)).toBeGreaterThan(3.5)
    expect(rest / (speedKmh / 3.6)).toBeLessThanOrEqual(4.5)
    // Within one tick's report cap at 20 m a report, so a tick never falls behind.
    expect(speedKmh / 3.6 / REPORT_STEP_M).toBeLessThan(MAX_REPORTS_PER_TICK)
    // The path ends at the trip's destination, so the trip ends by itself there (DD-30, arrival radius 50 m).
    expect(distanceM(path.points.at(-1)!, { lat: 25.0765, lng: 121.5742 })).toBeLessThan(50)
    for (const name of ['driver1', 'driver2', 'driver3', 'driver5']) expect(SIMULATOR_ROUTES[name].fastToEnd, name).toBeUndefined()
  })
})

describe('motion along the path (T63, T64, DD-14)', () => {
  const LENGTH = 5_000
  const KMH25 = 25 / 3.6

  it('stays at the start while parked', () => {
    expect(distanceAlong({ releasedAt: null, speedKmh: 25, fast: [] }, 600_000, LENGTH)).toBe(0)
  })

  it('moves at the set speed from the release, not from departure', () => {
    expect(distanceAlong({ releasedAt: 60_000, speedKmh: 25, fast: [] }, 70_000, LENGTH)).toBeCloseTo(10 * KMH25)
  })

  it('fast-forwards from the confirm to untilM, then the set speed again', () => {
    const motion = { releasedAt: 0, speedKmh: 25, fast: [{ at: 4_000, speedKmh: 250, untilM: 660 }] }
    const atConfirm = 4 * KMH25
    const fastS = (660 - atConfirm) / (250 / 3.6)
    expect(distanceAlong(motion, 4_000, LENGTH)).toBeCloseTo(atConfirm)
    expect(distanceAlong(motion, 6_000, LENGTH)).toBeCloseTo(atConfirm + 2 * (250 / 3.6))
    expect(distanceAlong(motion, 4_000 + fastS * 1000, LENGTH)).toBeCloseTo(660)
    expect(distanceAlong(motion, 4_000 + fastS * 1000 + 10_000, LENGTH)).toBeCloseTo(660 + 10 * KMH25)
  })

  it('does not fast-forward a car already past untilM when its passenger is confirmed', () => {
    const motion = { releasedAt: 0, speedKmh: 25, fast: [{ at: 120_000, speedKmh: 250, untilM: 660 }] }
    expect(distanceAlong(motion, 130_000, LENGTH)).toBeCloseTo(130 * KMH25)
  })

  it('never goes beyond the path end', () => {
    const motion = { releasedAt: 0, speedKmh: 25, fast: [{ at: 4_000, speedKmh: 250, untilM: 660 }] }
    expect(distanceAlong(motion, 3_600_000, LENGTH)).toBe(LENGTH)
  })

  it('a second fast-forward from boarding runs to the path end (T64)', () => {
    const toPickup = { at: 4_000, speedKmh: 2400, untilM: 660 }
    const toEnd = { at: 10_000, speedKmh: 8000, untilM: LENGTH }
    const motion = { releasedAt: 0, speedKmh: 25, fast: [toPickup, toEnd] }
    const pickupDoneAt = 4_000 + ((660 - 4 * KMH25) / (2400 / 3.6)) * 1000
    // At the set speed between the two: past 660 m, before boarding.
    const atBoarding = 660 + ((10_000 - pickupDoneAt) / 1000) * KMH25
    expect(distanceAlong(motion, 10_000, LENGTH)).toBeCloseTo(atBoarding)
    expect(distanceAlong(motion, 11_000, LENGTH)).toBeCloseTo(atBoarding + 8000 / 3.6)
    const endS = (LENGTH - atBoarding) / (8000 / 3.6)
    expect(distanceAlong(motion, 10_000 + endS * 1000, LENGTH)).toBeCloseTo(LENGTH)
    expect(distanceAlong(motion, 60_000, LENGTH)).toBe(LENGTH)
  })

  it('a boarding seen while still fast-forwarding to the pickup starts once that segment is done (T64)', () => {
    // Confirmed and boarded within the same second: the second segment follows the first.
    const motion = { releasedAt: 0, speedKmh: 25, fast: [{ at: 0, speedKmh: 250, untilM: 660 }, { at: 1_000, speedKmh: 8000, untilM: LENGTH }] }
    const pickupS = 660 / (250 / 3.6)
    expect(distanceAlong(motion, 5_000, LENGTH)).toBeCloseTo(5 * (250 / 3.6))
    expect(distanceAlong(motion, pickupS * 1000 + 1_000, LENGTH)).toBeCloseTo(660 + 8000 / 3.6)
  })
})
