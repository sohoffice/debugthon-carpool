import type { PassengerSearch, TagFilter } from '../../shared/src/api/types.ts'
import { SPEED_MPS, WALK_SPEED_MPS } from './config.ts'
import type { Lookups } from './context.ts'
import { distanceM } from './geo.ts'
import { etaToPickupS, passedPickup, seatsFree, type Candidate, type Trip, type World } from './world.ts'

export interface Match extends Candidate {
  etaS: number
  cost: number
}

function tagsOf(world: World, userId: number): Set<number> {
  const prefix = `${userId}:`
  return new Set(world.userTags.filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(prefix.length))))
}

function required(filters: TagFilter[]): number[] {
  return filters.filter((f) => f.intent === 'required').map((f) => f.tag_id)
}

/** Can this trip still take a new passenger at its pickup point? */
export function tripOpen(trip: Trip, lookups: Lookups, now: number): boolean {
  return trip.status === 'active' && !passedPickup(trip, now, lookups) && seatsFree(trip) > 0
}

/**
 * Simplified version of the matching engine's hard filters and ranking (design.md 4.11), shared by
 * supply and requests (DD-10). Demo staging: cars driven from the driver UI rank first, so the
 * person on stage gets the request (UD-14 normal scenario).
 */
export function matchTrips(world: World, lookups: Lookups, passengerId: number, pickupPointId: number, search: PassengerSearch, now: number): Match[] {
  const s = lookups.settings
  const passengerTags = tagsOf(world, passengerId)
  const preferred = search.tag_filters.filter((f) => f.intent === 'preferred').map((f) => f.tag_id)

  const matches = world.trips.flatMap((trip): (Match & { simulated: boolean })[] => {
    if (trip.pickupPointId !== pickupPointId || !tripOpen(trip, lookups, now)) return []
    const etaS = etaToPickupS(trip, now)
    if (etaS > s.wait_limit * 60) return []

    const driverTags = tagsOf(world, trip.driverId)
    if (!required(search.tag_filters).every((t) => driverTags.has(t))) return []
    if (!required(trip.tagFilters).every((t) => passengerTags.has(t))) return []

    const dropoff =
      distanceM(trip.destination, search.destination) <= s.address_match_distance
        ? { place: trip.destination, busStopId: null }
        : nearestAcceptedStop(trip, search)
    if (!dropoff) return []

    const matched = preferred.filter((t) => driverTags.has(t)).length
    const bonusS = preferred.length === 0 ? 0 : (s.tag_bonus_cap * 60 * matched) / preferred.length
    const rideS = distanceM(lookups.pickupById.get(pickupPointId)!, dropoff.place) / SPEED_MPS
    const walkS = distanceM(dropoff.place, search.destination) / WALK_SPEED_MPS
    const cost = etaS * s.wait_weight + rideS + walkS * s.walk_weight - bonusS

    return [{ tripId: trip.id, dropoff, relaxed: matched < preferred.length, etaS, cost, simulated: trip.simulated }]
  })

  return [...matches]
    .sort((a, b) => Number(a.simulated) - Number(b.simulated) || a.cost - b.cost || a.etaS - b.etaS)
    .map(({ simulated: _, ...m }) => m)
}

function nearestAcceptedStop(trip: Trip, search: PassengerSearch) {
  const accepted = new Set(search.accepted_stop_ids)
  const stops = trip.route.bus_stops.filter((b) => accepted.has(b.id))
  if (stops.length === 0) return null
  const best = stops.reduce((a, b) => (distanceM(a, search.destination) <= distanceM(b, search.destination) ? a : b))
  return { place: { name: best.name, lat: best.lat, lng: best.lng }, busStopId: best.id }
}
