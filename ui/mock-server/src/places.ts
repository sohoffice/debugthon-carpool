import type { Place } from '../../shared/src/api/types.ts'
import { PASSENGER_PROFILES, PREVIOUS_TRIPS } from './config.ts'
import type { Lookups } from './context.ts'
import { insidePolygon } from './geo.ts'

const MAX_RESULTS = 8

/**
 * Destinations the mock can "geocode": the seeded addresses plus the park's bus stops by name.
 * The real backend would use a geocoding service.
 */
export function buildPlaces(lookups: Lookups): Place[] {
  const addresses = [
    ...Object.values(PASSENGER_PROFILES).map((p) => p.destination),
    ...Object.values(PREVIOUS_TRIPS).map((p) => p.destination),
    ...lookups.data.seed.simulatedTrips.map((t) => t.destination),
  ]
  const stops = lookups.data.seed.busStops.map((b) => ({ name: b.name, lat: b.lat, lng: b.lng }))
  const seen = new Set<string>()
  return [...addresses, ...stops].filter((p) => !seen.has(p.name) && seen.add(p.name))
}

export function searchPlaces(places: Place[], query: string): Place[] {
  const q = query.replace(/\s+/g, '')
  return places.filter((p) => p.name.replace(/\s+/g, '').includes(q)).slice(0, MAX_RESULTS)
}

export function insidePark(lookups: Lookups, place: Place): boolean {
  return insidePolygon(place, lookups.data.parkRing)
}
