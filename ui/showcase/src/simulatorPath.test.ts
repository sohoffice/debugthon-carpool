import { distanceM } from '@carpool/shared'
import { describe, expect, it } from 'vitest'
import { SIMULATOR_ROUTES } from './simulatorRoutes'
import { distanceTravelled, makePath, MAX_REPORTS_PER_TICK, pointAt, REPORT_STEP_M, reportDistances } from './simulatorPath'

const SONGSHAN = { lat: 25.049806, lng: 121.578206 }
const PICKUP_RADIUS_M = 80
/** pass_margin (DD-06): passed once beyond the radius plus this. */
const PASS_MARGIN_M = 25
/** docs/demo-script.md: the request goes out about 40 s after driver4 departs; driver5 must not have passed by then. */
const SUBMIT_AFTER_S = 40

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

  it('driver5 has not passed the pickup when the request goes out, departing with driver4 (DD-45)', () => {
    const { speedKmh } = SIMULATOR_ROUTES.driver5
    const passedAfterS = (toPickup('driver5') + PICKUP_RADIUS_M + PASS_MARGIN_M) / (speedKmh / 3.6)
    expect(passedAfterS).toBeGreaterThan(SUBMIT_AFTER_S + 20)
  })
})
