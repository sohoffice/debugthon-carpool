import type {
  DriverProfile,
  DriverTrip,
  PassengerProfile,
  PassengerRequest,
  Ride,
  Supply,
  SupplyQuery,
  Tag,
  TripDefaults,
  TripView,
} from '../../shared/src/api/types.ts'
import { mustGet, type Lookups } from './context.ts'
import { pointAlong } from './geo.ts'
import { matchTrips } from './matching.ts'
import { canCancel } from './operations.ts'
import { alongAt, assignedTripId, etaToPickupS, findTrip, passedPickup, seatsFree, type RideRequest, type Trip, type World } from './world.ts'

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
    passed_pickup: false,
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

export function driverTripView(world: World, lookups: Lookups, trip: Trip, now: number): DriverTrip {
  const onTrip = world.requests.filter((r) => assignedTripId(r) === trip.id)
  const pending = onTrip.find((r) => r.status === 'waiting_driver')
  return {
    ...tripView(lookups, trip),
    passed_pickup: passedPickup(trip, now, lookups),
    ended_at: trip.endedAtMs === null ? null : iso(trip.endedAtMs),
    pending_request: pending
      ? {
          id: pending.id,
          pickup_point: mustGet(lookups.pickupById, pending.pickupPointId, 'pickup point'),
          dropoff: pending.candidates[pending.candidateIndex].dropoff.place,
        }
      : null,
    passengers: onTrip
      .filter((r) => r.status === 'confirmed' || r.status === 'boarded')
      .map((r) => ({ request_id: r.id, dropoff: r.candidates[r.candidateIndex].dropoff.place, boarded: r.status === 'boarded' })),
    completed_count: trip.completedCount,
  }
}

function rideView(world: World, lookups: Lookups, request: RideRequest, now: number): Ride | null {
  if (request.status !== 'confirmed' && request.status !== 'boarded' && request.status !== 'completed') return null
  const candidate = request.candidates[request.candidateIndex]
  const trip = findTrip(world, candidate.tripId)!
  const driver = mustGet(lookups.userById, trip.driverId, 'user')
  const passed = passedPickup(trip, now, lookups)
  const waiting = request.status === 'confirmed' && !passed
  const { position, heading } = pointAlong(trip.path, alongAt(trip, now))
  return {
    vehicle: lookups.data.seed.vehicles[driver.username] ?? { plate: '—', description: '' },
    // After boarding the passenger no longer sees the ETA (REQ-068).
    eta_s: waiting ? Math.round(etaToPickupS(trip, now)) : null,
    dropoff: { ...candidate.dropoff.place, bus_stop_id: candidate.dropoff.busStopId },
    route: trip.route,
    position: request.status === 'confirmed' ? { ...position, heading: Math.round(heading), reported_at: iso(now) } : null,
    passed_pickup: passed,
    simulated: true,
  }
}

export function passengerRequestView(world: World, lookups: Lookups, request: RideRequest, now: number): PassengerRequest {
  const pickup = mustGet(lookups.pickupById, request.pickupPointId, 'pickup point')
  const hasRide = request.status === 'confirmed' || request.status === 'boarded' || request.status === 'completed'
  return {
    id: request.id,
    status: request.status,
    pickup_point: pickup,
    destination: request.search.destination,
    reassigned: request.reassigned,
    relaxed: hasRide ? request.candidates[request.candidateIndex].relaxed : false,
    reject_reason:
      request.rejectDistanceM === null
        ? null
        : {
            code: 'too_far',
            message: `你離${pickup.name}約 ${request.rejectDistanceM} 公尺，走到 ${lookups.settings.submit_distance} 公尺內再送出。`,
            distance_m: request.rejectDistanceM,
          },
    ride: rideView(world, lookups, request, now),
    alternatives: request.alternatives,
    can_cancel: canCancel(world, lookups, request, now),
    created_at: iso(request.createdAtMs),
  }
}

/** The chosen pickup point's card and timeline (REQ-029, REQ-030). */
export function supplyView(world: World, lookups: Lookups, passengerId: number, query: SupplyQuery, now: number): Supply {
  const pickup = mustGet(lookups.pickupById, query.pickup_point_id, 'pickup point')
  const matches = matchTrips(world, lookups, passengerId, pickup.id, query, now)
  const vehicles = matches.map((m) => ({ id: m.tripId, eta_s: Math.round(m.etaS), simulated: true })).sort((a, b) => a.eta_s - b.eta_s)
  return {
    pickup_point: pickup,
    wait_limit_min: lookups.settings.wait_limit,
    submit_distance_m: lookups.settings.submit_distance,
    vehicle_count: vehicles.length,
    fastest_eta_s: vehicles[0]?.eta_s ?? null,
    seats: matches.reduce((sum, m) => sum + seatsFree(findTrip(world, m.tripId)!), 0),
    vehicles,
    simulated: true,
  }
}
