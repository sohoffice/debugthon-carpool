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

  it("driver4's fast-forward passes the pickup within about 10 s of 確認 (T63, DD-06)", () => {
    const fast = SIMULATOR_ROUTES.driver4.fastForward!
    const passAt = toPickup('driver4') + PICKUP_RADIUS_M + PASS_MARGIN_M
    expect(fast.untilM).toBeGreaterThan(passAt)
    // Even from the path start, leaving 2 s for the simulator's and the passenger UI's 1 s polls.
    expect(fast.untilM / (fast.speedKmh / 3.6)).toBeLessThanOrEqual(8)
  })
})

describe('motion along the path (T63, DD-14)', () => {
  const LENGTH = 5_000
  const KMH25 = 25 / 3.6

  it('stays at the start while parked', () => {
    expect(distanceAlong({ releasedAt: null, speedKmh: 25, fast: null }, 600_000, LENGTH)).toBe(0)
  })

  it('moves at the set speed from the release, not from departure', () => {
    expect(distanceAlong({ releasedAt: 60_000, speedKmh: 25, fast: null }, 70_000, LENGTH)).toBeCloseTo(10 * KMH25)
  })

  it('fast-forwards from the confirm to untilM, then the set speed again', () => {
    const motion = { releasedAt: 0, speedKmh: 25, fast: { at: 4_000, speedKmh: 250, untilM: 660 } }
    const atConfirm = 4 * KMH25
    const fastS = (660 - atConfirm) / (250 / 3.6)
    expect(distanceAlong(motion, 4_000, LENGTH)).toBeCloseTo(atConfirm)
    expect(distanceAlong(motion, 6_000, LENGTH)).toBeCloseTo(atConfirm + 2 * (250 / 3.6))
    expect(distanceAlong(motion, 4_000 + fastS * 1000, LENGTH)).toBeCloseTo(660)
    expect(distanceAlong(motion, 4_000 + fastS * 1000 + 10_000, LENGTH)).toBeCloseTo(660 + 10 * KMH25)
  })

  it('does not fast-forward a car already past untilM when its passenger is confirmed', () => {
    const motion = { releasedAt: 0, speedKmh: 25, fast: { at: 120_000, speedKmh: 250, untilM: 660 } }
    expect(distanceAlong(motion, 130_000, LENGTH)).toBeCloseTo(130 * KMH25)
  })

  it('never goes beyond the path end', () => {
    const motion = { releasedAt: 0, speedKmh: 25, fast: { at: 4_000, speedKmh: 250, untilM: 660 } }
    expect(distanceAlong(motion, 3_600_000, LENGTH)).toBe(LENGTH)
  })
})
