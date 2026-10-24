// @vitest-environment node
import { distanceM } from '@carpool/shared'
import { describe, expect, it } from 'vitest'
import { loadStaticData } from '../../mock-server/src/data/load.ts'
import { SIMULATOR_ROUTES } from './simulatorRoutes'

/** The default arrival distance (DD-30): a trip ends within this of its destination. */
const ARRIVAL_RADIUS_M = 50

describe('simulator routes (T08, T21)', () => {
  it('every seeded simulated trip ends where its path ends, so the trip can finish (DD-30)', () => {
    // The Go seed, read the same way as the mock backend, so a moved destination is caught.
    const trips = loadStaticData().seed.simulatedTrips
    expect(trips.map((t) => t.username)).toEqual(['driver1', 'driver2', 'driver3'])
    for (const { username, destination } of trips) {
      const [lat, lng] = SIMULATOR_ROUTES[username].path.at(-1)!
      expect(distanceM({ lat, lng }, destination), username).toBeLessThanOrEqual(ARRIVAL_RADIUS_M)
    }
  })
})
