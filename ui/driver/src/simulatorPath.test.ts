import { distanceM } from '@carpool/shared'
import { describe, expect, it } from 'vitest'
import { SIMULATOR_ROUTES } from './simulatorRoutes'
import { distanceTravelled, makePath, MAX_REPORTS_PER_TICK, pointAt, REPORT_STEP_M, reportDistances } from './simulatorPath'

const SONGSHAN = { lat: 25.049806, lng: 121.578206 }
const PICKUP_RADIUS_M = 80

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
})
