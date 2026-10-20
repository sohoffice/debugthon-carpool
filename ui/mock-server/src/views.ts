import type {
  DriverProfile,
  DriverRequestItem,
  DriverRequests,
  PassengerProfile,
  PassengerSearch,
  RequestStatusView,
  RequestView,
  Supply,
  Tag,
  TripDefaults,
  TripView,
} from '../../shared/src/api/types.ts'
import { mustGet, type Lookups } from './context.ts'
import { pointAlong } from './geo.ts'
import { matchTrips } from './matching.ts'
import { activeTripOf, alongAt, assignedTripId, etaToPickupS, findTrip, passedPickup, seatsFree, type RideRequest, type Trip, type World } from './world.ts'

const iso = (ms: number) => new Date(ms).toISOString()

export function tagsView(world: World, lookups: Lookups, userId: number): Tag[] {
  const mine = new Set(world.userTags)
  return lookups.data.seed.tags.map((t) => ({ ...t, selected: mine.has(`${userId}:${t.id}`) }))
}

export function passengerProfileView(world: World, lookups: Lookups, userId: number): PassengerProfile {
  const p = world.passengerProfiles[userId]
  return {
    usual_arrival_time: p?.arrival ?? null,
    usual_destination: p?.destination ?? null,
    accepted_stops: [...(p?.acceptedStopIds ?? [])].sort((a, b) => a - b).map((id) => mustGet(lookups.busStopById, id, 'bus stop')),
  }
}

export function driverProfileView(world: World, lookups: Lookups, userId: number): DriverProfile {
  const p = world.driverProfiles[userId]
  return {
    usual_pickup_point: p ? mustGet(lookups.pickupById, p.pickupPointId, 'pickup point') : null,
    usual_destination: p?.destination ?? null,
    capacity: p?.capacity ?? null,
  }
}

/** A trip shaped like the Go backend's tripView. */
export function tripView(lookups: Lookups, trip: Trip): TripView {
  return {
    id: trip.id,
    driver_id: trip.driverId,
    status: trip.status,
    pickup_point: mustGet(lookups.pickupById, trip.pickupPointId, 'pickup point'),
    destination: trip.destination,
    capacity: trip.capacity,
    seats_held: trip.seatsHeld,
    seats_confirmed: trip.seatsConfirmed,
    seats_available: seatsFree(trip),
    auto_accept: trip.autoAccept,
    settings_locked: true,
    passed_pickup: trip.reports.passedPickup,
    tag_filters: trip.tagFilters.map((f) => ({ ...f, name: lookups.tagById.get(f.tag_id)?.name })),
    route: trip.route,
    started_at: iso(trip.startedAtMs),
  }
}

/** GET /api/driver/trips/defaults: the last departure's settings (REQ-016). */
export function tripDefaultsView(trip: Trip | undefined): TripDefaults {
  if (!trip) return { pickup_point_id: null, destination: null, capacity: null, auto_accept: false, tag_filters: [] }
  return {
    pickup_point_id: trip.pickupPointId,
    destination: trip.destination,
    capacity: trip.capacity,
    auto_accept: trip.autoAccept,
    tag_filters: [...trip.tagFilters].sort((a, b) => a.tag_id - b.tag_id),
  }
}

const isoOrNull = (ms: number | null) => (ms === null ? null : iso(ms))

/** The request as the Go backend's requestView. */
export function requestView(request: RideRequest): RequestView {
  const candidate = request.candidates[request.candidateIndex]
  const assigned = request.status !== 'rejected' && request.status !== 'no_match' && candidate !== undefined
  return {
    id: request.id,
    status: request.status,
    reason: request.status === 'rejected' ? 'too_far' : null,
    message: request.rejectMessage,
    relaxed: assigned ? candidate.relaxed : false,
    pickup_point_id: request.pickupPointId,
    submitted_lat: request.location.lat,
    submitted_lng: request.location.lng,
    trip_id: assigned ? candidate.tripId : null,
    dropoff_bus_stop_id: assigned ? candidate.dropoff.busStopId : null,
    response_deadline_at: isoOrNull(request.deadlineMs),
    confirmed_at: isoOrNull(request.confirmedAtMs),
    boarded_at: isoOrNull(request.boardedAtMs),
    completed_at: isoOrNull(request.completedAtMs),
    created_at: iso(request.createdAtMs),
  }
}

/**
 * GET /api/passenger/requests/:id, like the Go backend: the pickup point, car, ETA and trip only
 * while confirmed (DD-27). The car's position and passed_pickup are the UI's proposal for T22 (DD-31).
 */
export function requestStatusView(world: World, lookups: Lookups, request: RideRequest, now: number): RequestStatusView {
  const base = { ...requestView(request), reassigned_count: request.reassignedCount }
  if (request.status === 'no_match') return { ...base, reason: 'no_match', message: '目前沒有可搭的車', pickup_point: null, vehicle: null, eta_s: null, trip: null }
  if (request.status !== 'confirmed') return { ...base, pickup_point: null, vehicle: null, eta_s: null, trip: null }
  const trip = findTrip(world, assignedTripId(request)!)!
  const driver = mustGet(lookups.userById, trip.driverId, 'user')
  const passed = passedPickup(trip, now, lookups)
  const { position, heading } = pointAlong(trip.path, alongAt(trip, now))
  return {
    ...base,
    pickup_point: mustGet(lookups.pickupById, request.pickupPointId, 'pickup point'),
    vehicle: lookups.data.seed.vehicles[driver.username] ?? { plate: '', description: '' },
    eta_s: passed ? null : Math.round(etaToPickupS(trip, now)),
    trip: tripView(lookups, trip),
    vehicle_position: { ...position, heading: Math.round(heading), reported_at: iso(now) },
    passed_pickup: passed,
  }
}

function driverRequestItem(lookups: Lookups, request: RideRequest): DriverRequestItem {
  const candidate = request.candidates[request.candidateIndex]
  const { place, busStopId } = candidate.dropoff
  return {
    id: request.id,
    status: request.status as DriverRequestItem['status'],
    passenger_name: mustGet(lookups.userById, request.passengerId, 'user').display_name,
    pickup_point: mustGet(lookups.pickupById, request.pickupPointId, 'pickup point'),
    dropoff: { bus_stop_id: busStopId, ...place },
    relaxed: candidate.relaxed,
    response_deadline_at: isoOrNull(request.deadlineMs),
    boarded: request.status === 'boarded',
    boarded_at: isoOrNull(request.boardedAtMs),
  }
}

/** GET /api/driver/requests: the running trip's requests, like the Go backend (REQ-049, REQ-066). */
export function driverRequestsView(world: World, lookups: Lookups, driverId: number): DriverRequests {
  const trip = activeTripOf(world, driverId)
  if (!trip) return { trip_id: null, pending: [], passengers: [] }
  const onTrip = world.requests.filter((r) => assignedTripId(r) === trip.id)
  return {
    trip_id: trip.id,
    pending: onTrip.filter((r) => r.status === 'waiting_driver').map((r) => driverRequestItem(lookups, r)),
    passengers: onTrip.filter((r) => r.status === 'confirmed' || r.status === 'boarded').map((r) => driverRequestItem(lookups, r)),
  }
}

/** GET /api/passenger/supply: the chosen pickup point's card and timeline, like the Go backend (REQ-029, REQ-030). */
export function supplyView(world: World, lookups: Lookups, passengerId: number, pickupPointId: number, search: PassengerSearch, now: number): Supply {
  const matches = matchTrips(world, lookups, passengerId, pickupPointId, search, now)
  const cars = matches
    .map((m) => ({ trip_id: m.tripId, eta_s: Math.round(m.etaS), seats_available: seatsFree(findTrip(world, m.tripId)!) }))
    .sort((a, b) => a.eta_s - b.eta_s)
  return {
    pickup_point: mustGet(lookups.pickupById, pickupPointId, 'pickup point'),
    destination: search.destination,
    accepted_stop_ids: search.accepted_stop_ids,
    card: { count: cars.length, fastest_eta_s: cars[0]?.eta_s ?? null, seats_remaining: cars.reduce((sum, c) => sum + c.seats_available, 0) },
    timeline_range_s: lookups.settings.wait_limit * 60,
    cars,
  }
}
