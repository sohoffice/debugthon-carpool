import type {
  Alternative,
  MockScenario,
  Place,
  RequestStatus,
  Route,
  TagFilter,
  TripStatus,
  PassengerSearch,
} from '../../shared/src/api/types.ts'
import { ARRIVAL_RADIUS_M, PASSENGER_PROFILES, PREVIOUS_TRIPS, SIMULATED_START_ETA_S, SPEED_MPS } from './config.ts'
import { mustGet, type Lookups } from './context.ts'
import { MockError } from './errors.ts'
import type { LatLng, Path } from './geo.ts'
import { buildTripPath } from './tripPath.ts'

export interface Trip {
  id: number
  driverId: number
  pickupPointId: number
  destination: Place
  capacity: number
  autoAccept: boolean
  tagFilters: TagFilter[]
  path: Path
  pickupAlong: number
  route: Route
  /** Metres along the path at `startedAtMs`. */
  startAlong: number
  startedAtMs: number
  status: TripStatus
  endedAtMs: number | null
  seatsHeld: number
  seatsConfirmed: number
  completedCount: number
  simulated: boolean
}

export interface Dropoff {
  place: Place
  busStopId: number | null
}

/** One car in a request's ranked assignment order (request_candidates). */
export interface Candidate {
  tripId: number
  dropoff: Dropoff
  relaxed: boolean
}

export interface RideRequest {
  id: number
  passengerId: number
  pickupPointId: number
  search: PassengerSearch
  /** Where the passenger was when sending it; the submit distance is checked against it (DD-25). */
  location: LatLng
  status: RequestStatus
  candidates: Candidate[]
  /** The candidate currently assigned (waiting, confirmed or completed). */
  candidateIndex: number
  reassigned: boolean
  deadlineMs: number | null
  rejectDistanceM: number | null
  alternatives: Alternative[]
  createdAtMs: number
}

export interface DriverProfileState {
  pickupPointId: number
  destination: Place
  capacity: number
}

export interface PassengerProfileState {
  arrival: string | null
  destination: Place | null
  acceptedStopIds: number[]
}

/** A user taking part today; location reports go to the user's latest one (DD-25). */
export interface MockActivity {
  id: number
  userId: number
  role: 'driver' | 'passenger'
  tripId: number | null
  createdAtMs: number
}

export interface MockReport {
  id: number
  lat: number
  lng: number
  atMs: number
}

/** All mock state. Replaced, never mutated: every operation returns a new World. */
export interface World {
  scenario: MockScenario
  clockOffsetMs: number
  nextTripId: number
  nextRequestId: number
  nextActivityId: number
  nextReportId: number
  trips: Trip[]
  requests: RideRequest[]
  activities: MockActivity[]
  /** Only the last report per activity is kept; car movement is computed from time, not reports. */
  lastReports: Record<number, MockReport>
  /** `${userId}:${tagId}` */
  userTags: string[]
  driverProfiles: Record<number, DriverProfileState>
  passengerProfiles: Record<number, PassengerProfileState>
}

// ---------------------------------------------------------------- progress along the path

export function alongAt(trip: Trip, now: number): number {
  const end = trip.status === 'completed' && trip.endedAtMs !== null ? trip.endedAtMs : now
  return Math.min(trip.startAlong + (Math.max(end - trip.startedAtMs, 0) / 1000) * SPEED_MPS, trip.path.length)
}

/** Passed = entered the pickup area and left it beyond the leave margin (DD-06). */
export function passedPickup(trip: Trip, now: number, lookups: Lookups): boolean {
  const pickup = mustGet(lookups.pickupById, trip.pickupPointId, 'pickup point')
  return alongAt(trip, now) > trip.pickupAlong + pickup.radius_m + (lookups.settings.pass_margin ?? 0)
}

export function etaToPickupS(trip: Trip, now: number): number {
  return Math.max(trip.pickupAlong - alongAt(trip, now), 0) / SPEED_MPS
}

export function seatsFree(trip: Trip): number {
  return trip.capacity - trip.seatsHeld - trip.seatsConfirmed
}

// ---------------------------------------------------------------- small immutable helpers

export function updateTrip(world: World, id: number, change: (t: Trip) => Trip): World {
  return { ...world, trips: world.trips.map((t) => (t.id === id ? change(t) : t)) }
}

export function updateRequest(world: World, id: number, change: (r: RideRequest) => RideRequest): World {
  return { ...world, requests: world.requests.map((r) => (r.id === id ? change(r) : r)) }
}

export function findTrip(world: World, id: number): Trip | undefined {
  return world.trips.find((t) => t.id === id)
}

export function assignedTripId(request: RideRequest): number | null {
  return request.candidates[request.candidateIndex]?.tripId ?? null
}

// ---------------------------------------------------------------- creating trips

interface NewTrip {
  driverId: number
  pickupPointId: number
  destination: Place
  capacity: number
  autoAccept: boolean
  tagFilters: TagFilter[]
  simulated: boolean
  /** Seconds before reaching the pickup point at `now`. */
  startEtaS: number
}

export function addTrip(world: World, lookups: Lookups, spec: NewTrip, now: number): World {
  const pickup = mustGet(lookups.pickupById, spec.pickupPointId, 'pickup point')
  const tripPath = buildTripPath(lookups, pickup, spec.destination)
  const trip: Trip = {
    id: world.nextTripId,
    driverId: spec.driverId,
    pickupPointId: spec.pickupPointId,
    destination: spec.destination,
    capacity: spec.capacity,
    autoAccept: spec.autoAccept,
    tagFilters: spec.tagFilters,
    ...tripPath,
    startAlong: Math.max(tripPath.pickupAlong - spec.startEtaS * SPEED_MPS, 0),
    startedAtMs: now,
    status: 'active',
    endedAtMs: null,
    seatsHeld: 0,
    seatsConfirmed: 0,
    completedCount: 0,
    simulated: spec.simulated,
  }
  // Departing is the driver taking part today (DD-25).
  const withTrip = { ...world, nextTripId: world.nextTripId + 1, trips: [...world.trips, trip] }
  return addActivity(withTrip, spec.driverId, 'driver', trip.id, now)
}

export function addActivity(world: World, userId: number, role: 'driver' | 'passenger', tripId: number | null, now: number): World {
  const activity: MockActivity = { id: world.nextActivityId, userId, role, tripId, createdAtMs: now }
  return { ...world, nextActivityId: world.nextActivityId + 1, activities: [...world.activities, activity] }
}

export function latestActivityOf(world: World, userId: number): MockActivity | undefined {
  return world.activities.filter((a) => a.userId === userId).at(-1)
}

/** The state after reset (UD-18): accounts, tags and simulated trips kept; everything else cleared. */
export function initialWorld(lookups: Lookups, scenario: MockScenario, now: number): World {
  const { seed } = lookups.data
  const user = (name: string) => mustGet(lookups.userByName, name, 'user')
  const tag = (name: string) => mustGet(lookups.tagByName, name, 'tag')
  const songshan = mustGet(lookups.pickupByName, '松山車站', 'pickup point')

  const empty: World = {
    scenario,
    clockOffsetMs: 0,
    nextTripId: 1,
    nextRequestId: 1,
    nextActivityId: 1,
    nextReportId: 1,
    trips: [],
    requests: [],
    activities: [],
    lastReports: {},
    userTags: seed.userTags.map((ut) => `${user(ut.username).id}:${tag(ut.tag).id}`),
    driverProfiles: {},
    passengerProfiles: Object.fromEntries(
      Object.entries(PASSENGER_PROFILES).map(([name, p]) => [
        user(name).id,
        {
          arrival: p.arrival,
          destination: p.destination,
          acceptedStopIds: p.acceptedStopIds.map((stopId) => mustGet(lookups.busStopByStopId, stopId, 'bus stop').id),
        },
      ]),
    ),
  }

  // No simulated cars in the no_cars scenario.
  const withSimulated =
    scenario === 'no_cars'
      ? empty
      : seed.simulatedTrips.reduce(
          (w, t) =>
            addTrip(
              w,
              lookups,
              {
                driverId: user(t.username).id,
                pickupPointId: songshan.id,
                destination: t.destination,
                capacity: t.capacity,
                autoAccept: true,
                tagFilters: [],
                simulated: true,
                startEtaS: SIMULATED_START_ETA_S[t.username] ?? 300,
              },
              now,
            ),
          empty,
        )

  return Object.entries(PREVIOUS_TRIPS).reduce((w, [name, p]) => {
    const yesterday = now - 24 * 3600 * 1000
    const added = addTrip(
      w,
      lookups,
      {
        driverId: user(name).id,
        pickupPointId: mustGet(lookups.pickupByName, p.pickup, 'pickup point').id,
        destination: p.destination,
        capacity: p.capacity,
        autoAccept: p.autoAccept,
        tagFilters: p.preferredTags.map((t) => ({ tag_id: tag(t).id, intent: 'preferred' as const })),
        simulated: false,
        startEtaS: 0,
      },
      yesterday,
    )
    return updateTrip(added, added.nextTripId - 1, (t) => ({ ...t, status: 'completed', endedAtMs: yesterday + 20 * 60 * 1000 }))
  }, withSimulated)
}

// ---------------------------------------------------------------- driver trip state

export function activeTripOf(world: World, driverId: number): Trip | undefined {
  return world.trips.find((t) => t.driverId === driverId && t.status === 'active')
}

export function latestTripOf(world: World, driverId: number): Trip | undefined {
  return world.trips.filter((t) => t.driverId === driverId).at(-1)
}

export function requireRequest(world: World, id: number): RideRequest {
  const request = world.requests.find((r) => r.id === id)
  if (!request) throw new MockError(404, 'not_found', '找不到這個請求')
  return request
}

/** Moves the trip's seat counters for a request that leaves `from` and enters `to`. */
export function moveSeat(world: World, tripId: number, from: 'held' | 'confirmed' | null, to: 'held' | 'confirmed' | null): World {
  const delta = (kind: 'held' | 'confirmed') => (to === kind ? 1 : 0) - (from === kind ? 1 : 0)
  return updateTrip(world, tripId, (t) => ({
    ...t,
    seatsHeld: t.seatsHeld + delta('held'),
    seatsConfirmed: t.seatsConfirmed + delta('confirmed'),
  }))
}

export function arrivedAtDestination(trip: Trip, now: number): boolean {
  return alongAt(trip, now) >= trip.path.length - ARRIVAL_RADIUS_M
}

