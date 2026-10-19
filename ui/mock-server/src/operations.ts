import type { DepartureSettings, LatLngBody, RequestSubmission } from '../../shared/src/api/types.ts'
import { findAlternatives } from './alternatives.ts'
import { HUMAN_START_ETA_S, REASSIGN_TIMEOUT_S } from './config.ts'
import { mustGet, type Lookups } from './context.ts'
import { MockError } from './errors.ts'
import { distanceM } from './geo.ts'
import { matchTrips, tripOpen } from './matching.ts'
import {
  activeTripOf,
  addActivity,
  addTrip,
  arrivedAtDestination,
  assignedTripId,
  findTrip,
  latestActivityOf,
  moveSeat,
  passedPickup,
  requireRequest,
  updateRequest,
  updateTrip,
  type RideRequest,
  type World,
} from './world.ts'

// ---------------------------------------------------------------- assignment (DD-12, REQ-050)

function confirmTimeoutMs(world: World, lookups: Lookups): number {
  return (world.scenario === 'reassign' ? REASSIGN_TIMEOUT_S : lookups.settings.driver_confirm_timeout) * 1000
}

/** Gives the request to the first still-open candidate from `from`; no_match when none is left. */
function assignFrom(world: World, lookups: Lookups, requestId: number, from: number, now: number): World {
  const request = requireRequest(world, requestId)
  const index = request.candidates.findIndex((c, i) => {
    const trip = findTrip(world, c.tripId)
    return i >= from && trip !== undefined && tripOpen(trip, lookups, now)
  })
  if (index < 0) {
    const pickup = mustGet(lookups.pickupById, request.pickupPointId, 'pickup point')
    return updateRequest(world, requestId, (r) => ({
      ...r,
      status: 'no_match',
      candidateIndex: r.candidates.length,
      deadlineMs: null,
      alternatives: findAlternatives(lookups, pickup, r.search),
    }))
  }
  const trip = findTrip(world, request.candidates[index].tripId)!
  const status = trip.autoAccept ? 'confirmed' : 'waiting_driver'
  const held = moveSeat(world, trip.id, null, trip.autoAccept ? 'confirmed' : 'held')
  const linked = trip.autoAccept ? linkActivity(held, request.passengerId, trip.id) : held
  return updateRequest(linked, requestId, (r) => ({
    ...r,
    status,
    candidateIndex: index,
    reassigned: r.reassigned || from > 0,
    deadlineMs: trip.autoAccept ? null : now + confirmTimeoutMs(world, lookups),
  }))
}

/** A confirmed passenger's latest activity joins the trip (DD-25). */
function linkActivity(world: World, passengerId: number, tripId: number): World {
  const activity = latestActivityOf(world, passengerId)
  if (!activity || activity.role !== 'passenger') return world
  return { ...world, activities: world.activities.map((a) => (a.id === activity.id ? { ...a, tripId } : a)) }
}

/** Declined, timed out, or the car is gone: release the hold and try the next car. */
function reassign(world: World, lookups: Lookups, request: RideRequest, now: number): World {
  const tripId = assignedTripId(request)
  const released = tripId === null ? world : moveSeat(world, tripId, 'held', null)
  return assignFrom(released, lookups, request.id, request.candidateIndex + 1, now)
}

function finishRide(world: World, request: RideRequest): World {
  const tripId = assignedTripId(request)!
  const trip = findTrip(world, tripId)!
  const freed = updateTrip(moveSeat(world, tripId, 'confirmed', null), tripId, (t) => ({ ...t, completedCount: t.completedCount + 1 }))
  const done = updateRequest(freed, request.id, (r) => ({ ...r, status: 'completed' }))
  // Habitual data is updated from completed rides (DD-19).
  return {
    ...done,
    driverProfiles: {
      ...done.driverProfiles,
      [trip.driverId]: { pickupPointId: trip.pickupPointId, destination: trip.destination, capacity: trip.capacity },
    },
    passengerProfiles: {
      ...done.passengerProfiles,
      [request.passengerId]: {
        arrival: done.passengerProfiles[request.passengerId]?.arrival ?? null,
        destination: request.search.destination,
        acceptedStopIds: request.search.accepted_stop_ids,
      },
    },
  }
}

// ---------------------------------------------------------------- time passing

/** Ends trips that reached their destination and requests that timed out (UD-16, DD-13). */
export function tick(world: World, lookups: Lookups, now: number): World {
  const afterTrips = world.trips.reduce((w, trip) => {
    if (trip.status !== 'active') return w
    const riders = w.requests.filter((r) => assignedTripId(r) === trip.id && isOpen(r))
    if (arrivedAtDestination(trip, now)) return endTrip(w, lookups, trip.id, now)
    // A simulated car with nobody on board starts over once past the pickup, so the supply stays alive.
    if (trip.simulated && riders.length === 0 && passedPickup(trip, now, lookups)) return respawn(w, lookups, trip.id, now)
    return w
  }, world)

  return afterTrips.requests.reduce((w, r) => {
    if (r.status !== 'waiting_driver') return w
    const trip = findTrip(w, assignedTripId(r)!)
    const expired = r.deadlineMs !== null && now >= r.deadlineMs
    return expired || !trip || trip.status !== 'active' ? reassign(w, lookups, r, now) : w
  }, afterTrips)
}

function endTrip(world: World, lookups: Lookups, tripId: number, now: number): World {
  const ended = updateTrip(world, tripId, (t) => ({ ...t, status: 'completed', endedAtMs: now }))
  const onTrip = ended.requests.filter((r) => assignedTripId(r) === tripId)
  const settled = onTrip.reduce((w, r) => {
    if (r.status === 'confirmed' || r.status === 'boarded') return finishRide(w, r)
    if (r.status === 'waiting_driver') return reassign(w, lookups, r, now)
    return w
  }, ended)
  const trip = findTrip(settled, tripId)!
  return trip.simulated ? respawn(settled, lookups, tripId, now) : settled
}

/** A simulated car starts again from the beginning of its approach. */
function respawn(world: World, lookups: Lookups, tripId: number, now: number): World {
  const old = findTrip(world, tripId)!
  const ended = updateTrip(world, tripId, (t) => (t.status === 'active' ? { ...t, status: 'completed', endedAtMs: now } : t))
  return addTrip(
    ended,
    lookups,
    {
      driverId: old.driverId,
      pickupPointId: old.pickupPointId,
      destination: old.destination,
      capacity: old.capacity,
      autoAccept: old.autoAccept,
      tagFilters: old.tagFilters,
      simulated: true,
      startEtaS: Number.POSITIVE_INFINITY,
    },
    now,
  )
}

// ---------------------------------------------------------------- driver actions

export function depart(world: World, lookups: Lookups, driverId: number, settings: DepartureSettings, now: number): World {
  if (activeTripOf(world, driverId)) throw new MockError(409, 'already_active', '駕駛已有進行中的行程')
  return addTrip(
    world,
    lookups,
    {
      driverId,
      pickupPointId: settings.pickup_point_id,
      destination: settings.destination,
      capacity: settings.capacity,
      autoAccept: settings.auto_accept,
      tagFilters: settings.tag_filters,
      simulated: false,
      startEtaS: HUMAN_START_ETA_S,
    },
    now,
  )
}

function driverRequest(world: World, driverId: number, requestId: number): RideRequest {
  const request = requireRequest(world, requestId)
  const tripId = assignedTripId(request)
  const trip = tripId === null ? undefined : findTrip(world, tripId)
  if (!trip || trip.driverId !== driverId) throw new MockError(404, 'not_found', '找不到這個請求')
  return request
}

export function accept(world: World, driverId: number, requestId: number): World {
  const request = driverRequest(world, driverId, requestId)
  if (request.status !== 'waiting_driver') throw new MockError(409, 'request_not_pending', '這個請求已經不需要回應')
  const moved = linkActivity(moveSeat(world, assignedTripId(request)!, 'held', 'confirmed'), request.passengerId, assignedTripId(request)!)
  return updateRequest(moved, requestId, (r) => ({ ...r, status: 'confirmed', deadlineMs: null }))
}

export function decline(world: World, lookups: Lookups, driverId: number, requestId: number, now: number): World {
  const request = driverRequest(world, driverId, requestId)
  if (request.status !== 'waiting_driver') throw new MockError(409, 'request_not_pending', '這個請求已經不需要回應')
  return reassign(world, lookups, request, now)
}

/** Either side can mark boarding; the first one wins, the second is a no-op (DD-27). */
export function boardRide(world: World, request: RideRequest): World {
  if (request.status === 'boarded') return world
  if (request.status !== 'confirmed') throw new MockError(409, 'request_not_confirmed', '這個請求還沒有確認')
  return updateRequest(world, request.id, (r) => ({ ...r, status: 'boarded' }))
}

/** Either side can end a ride, boarded or not; the first one wins, the second is a no-op (DD-23). */
export function completeRide(world: World, request: RideRequest): World {
  if (request.status === 'completed') return world
  if (request.status !== 'confirmed' && request.status !== 'boarded') throw new MockError(409, 'request_not_confirmed', '這個請求還沒有確認')
  return finishRide(world, request)
}

export function driverBoardRide(world: World, driverId: number, requestId: number): World {
  return boardRide(world, driverRequest(world, driverId, requestId))
}

export function driverCompleteRide(world: World, driverId: number, requestId: number): World {
  return completeRide(world, driverRequest(world, driverId, requestId))
}

// ---------------------------------------------------------------- passenger actions

const isOpen = (r: RideRequest) => r.status === 'waiting_driver' || r.status === 'confirmed' || r.status === 'boarded'

export function openRequestOf(world: World, passengerId: number): RideRequest | undefined {
  return world.requests.find((r) => r.passengerId === passengerId && isOpen(r))
}

/** Decides at once: rejected, no_match, waiting_driver or confirmed (REQ-034, REQ-036). */
export function submitRequest(world: World, lookups: Lookups, passengerId: number, submission: RequestSubmission, now: number): World {
  if (openRequestOf(world, passengerId)) throw new MockError(409, 'request_active', '已經有進行中的請求')
  const pickup = mustGet(lookups.pickupById, submission.pickup_point_id, 'pickup point')
  const { location, pickup_point_id: _, ...search } = submission
  // The distance is checked against the position sent with the request, not the reports (DD-25).
  const distance = Math.round(distanceM(pickup, location))
  const tooFar = distance > lookups.settings.submit_distance
  const request: RideRequest = {
    id: world.nextRequestId,
    passengerId,
    pickupPointId: pickup.id,
    search,
    location,
    status: 'rejected',
    candidates: tooFar ? [] : matchTrips(world, lookups, passengerId, pickup.id, search, now),
    candidateIndex: 0,
    reassigned: false,
    deadlineMs: null,
    rejectDistanceM: tooFar ? distance : null,
    alternatives: [],
    createdAtMs: now,
  }
  const added = { ...world, nextRequestId: world.nextRequestId + 1, requests: [...world.requests, request] }
  return tooFar ? added : assignFrom(added, lookups, request.id, 0, now)
}

export function canCancel(world: World, lookups: Lookups, request: RideRequest, now: number): boolean {
  if (request.status === 'waiting_driver') return true
  if (request.status !== 'confirmed') return false
  return !passedPickup(findTrip(world, assignedTripId(request)!)!, now, lookups)
}

/** Before boarding only; the seat is released (UD-17). */
export function cancelRequest(world: World, lookups: Lookups, request: RideRequest, now: number): World {
  if (request.status === 'boarded') throw new MockError(409, 'cannot_cancel', '上車後不能取消請求')
  if (request.status !== 'waiting_driver' && request.status !== 'confirmed') throw new MockError(409, 'request_closed', '這個請求已經結束')
  if (!canCancel(world, lookups, request, now)) throw new MockError(409, 'cannot_cancel', '上車後不能取消請求')
  const tripId = assignedTripId(request)!
  const released = moveSeat(world, tripId, request.status === 'confirmed' ? 'confirmed' : 'held', null)
  return updateRequest(released, request.id, (r) => ({ ...r, status: 'cancelled', deadlineMs: null }))
}

// ---------------------------------------------------------------- participation and positions (DD-25, DD-08)

/** POST /api/activities: a driver's is linked to the running trip, a passenger's to nothing yet. */
export function declareActivity(world: World, userId: number, role: 'driver' | 'passenger', now: number): World {
  if (role === 'passenger') return addActivity(world, userId, role, null, now)
  const trip = activeTripOf(world, userId)
  if (!trip) throw new MockError(409, 'no_active_trip', '駕駛目前沒有進行中的行程')
  return addActivity(world, userId, role, trip.id, now)
}

/**
 * POST /api/location. Stored under the caller's latest activity, refused without one. A driver's
 * report updates the trip's passed_pickup like the Go backend (DD-06: entered the pickup area, then
 * beyond radius + leave margin). The mock's cars still move by time, so reports do not move them (10.2).
 */
export function reportLocation(world: World, lookups: Lookups, userId: number, position: LatLngBody, now: number): World {
  const activity = latestActivityOf(world, userId)
  if (!activity) throw new MockError(409, 'no_activity', '請先表示今天要參與，再回報位置')
  const report = { id: world.nextReportId, lat: position.lat, lng: position.lng, atMs: now }
  const stored = { ...world, nextReportId: world.nextReportId + 1, lastReports: { ...world.lastReports, [activity.id]: report } }
  if (activity.role !== 'driver' || activity.tripId === null) return stored
  return updateTrip(stored, activity.tripId, (t) => {
    if (t.reports.passedPickup) return t
    const pickup = mustGet(lookups.pickupById, t.pickupPointId, 'pickup point')
    const d = distanceM(pickup, position)
    if (d <= pickup.radius_m) return { ...t, reports: { enteredPickup: true, passedPickup: false } }
    const passed = t.reports.enteredPickup && d > pickup.radius_m + (lookups.settings.pass_margin ?? 0)
    return passed ? { ...t, reports: { enteredPickup: true, passedPickup: true } } : t
  })
}
