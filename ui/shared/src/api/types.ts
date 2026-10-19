// API shapes shared by the apps and the mock backend (docs/ui-design.md 10.1, UD-14).
// "Existing" types mirror the Go backend exactly; "Proposed" types are defined by the UI
// (ui-oi-10) and are to be agreed with the backend. All field names are snake_case like Go.
// Times are RFC 3339 strings; distances in metres; durations in seconds unless named _min.

// ---------------------------------------------------------------- Existing (Go backend)

export interface ApiErrorBody {
  error: { code: string; message: string }
}

/** GET /api/me */
export interface Me {
  username: string
  display_name: string
  role: 'driver' | 'passenger'
  roles: ('driver' | 'passenger')[]
  simulated: boolean
}

export interface Place {
  name: string
  lat: number
  lng: number
}

export interface LatLngBody {
  lat: number
  lng: number
}

/** GET /api/pickup-points */
export interface PickupPoint {
  id: number
  name: string
  lat: number
  lng: number
  radius_m: number
}

/** GET /api/bus-stops. `stop_id` is the open-data stop id. */
export interface BusStop {
  id: number
  stop_id: number | null
  name: string
  lat: number
  lng: number
}

/** GET /api/tags; select with PUT /api/me/tags/:id, deselect with DELETE (both 204). */
export interface Tag {
  id: number
  name: string
  issuer: string
  selected: boolean
}

/** GET /api/driver/profile. Every field is null before the first completed ride (DD-19). */
export interface DriverProfile {
  usual_pickup_point: PickupPoint | null
  usual_destination: Place | null
  capacity: number | null
}

/** GET /api/passenger/profile */
export interface PassengerProfile {
  usual_arrival_time: string | null
  usual_destination: Place | null
  accepted_stops: BusStop[]
}

export type TagIntent = 'required' | 'preferred'

/** A tag filter with its intent (REQ-013). Tags without a filter are simply absent. */
export interface TagFilter {
  tag_id: number
  intent: TagIntent
}

/** Trip route from the pickup point to the destination (DD-21). */
export interface Route {
  /** Google encoded polyline, like trips.route_polyline. */
  polyline: string
  distance_m: number
  duration_s: number
  /** True when the route is estimated rather than from a routing service (REQ-063). */
  simulated: boolean
  /** Bus stops along the route, in travel order. */
  bus_stops: BusStop[]
}

/** Body of POST /api/driver/trips ("我出發了"). */
export interface DepartureSettings {
  pickup_point_id: number
  destination: Place
  capacity: number
  auto_accept: boolean
  tag_filters: TagFilter[]
}

export type TripStatus = 'active' | 'completed'

/**
 * A trip as the Go backend returns it: POST /api/driver/trips (201), GET /api/driver/trips/current
 * (404 not_found when none is running) and GET /api/trips/:id. A second departure while one runs
 * is 409 already_active.
 */
export interface TripView {
  id: number
  driver_id: number
  status: TripStatus
  pickup_point: PickupPoint
  destination: Place
  capacity: number
  seats_held: number
  seats_confirmed: number
  seats_available: number
  auto_accept: boolean
  settings_locked: boolean
  passed_pickup: boolean
  tag_filters: (TagFilter & { name?: string })[]
  /** Null only for a simulated trip whose route is not built yet. */
  route: Route | null
  started_at: string | null
}

/** GET /api/driver/trips/defaults — the last departure's settings; all empty if never departed (REQ-016). */
export interface TripDefaults {
  pickup_point_id: number | null
  destination: Place | null
  capacity: number | null
  auto_accept: boolean
  tag_filters: TagFilter[]
}

/**
 * POST /api/activities (201): the caller takes part today (DD-25). A driver's is linked to the
 * running trip (409 no_active_trip without one); a passenger's when a request is confirmed.
 */
export interface Activity {
  id: number
  role: 'driver' | 'passenger'
  trip_id: number | null
  created_at: string
}

/**
 * POST /api/location { lat, lng } (201), the single position API (DD-08). Stored under the
 * caller's latest activity; 409 no_activity before the first one.
 */
export interface LocationReport {
  id: number
  activity_id: number
  trip_id: number | null
  lat: number
  lng: number
  reported_at: string
  /** Only on a driver's report that belongs to a trip. */
  passed_pickup?: boolean
}

/** The driver's car (vehicles table), shown to the passenger once confirmed (REQ-052). */
export interface Vehicle {
  plate: string
  /** Colour and model, e.g. 白色 Toyota Altis. */
  description: string
}

// ---------------------------------------------------------------- Proposed: shared

/** GET /api/places?q=… — destinations inside the park, for the address field. */
export type PlaceSearchResult = Place[]

// ---------------------------------------------------------------- Proposed: driver

/** Body of POST /api/driver/route-preview; returns Route (422 destination_outside_park). */
export interface RoutePreviewRequest {
  pickup_point_id: number
  destination: Place
}

/** A request waiting for this driver's answer. No deadline: the driver sees no countdown (ui-oi-02). */
export interface DriverPendingRequest {
  id: number
  pickup_point: PickupPoint
  dropoff: Place
}

/** A confirmed passenger who has not finished the ride yet. */
export interface DriverPassenger {
  request_id: number
  dropoff: Place
  /** Marked by either side (DD-27, REQ-068). */
  boarded: boolean
}

/** The Go trip plus what the driver polls for while driving (DD-04). */
export interface DriverTrip extends TripView {
  ended_at: string | null
  pending_request: DriverPendingRequest | null
  passengers: DriverPassenger[]
  /** Rides finished on this trip ("今天載了 2 位乘客"). */
  completed_count: number
}

/**
 * GET /api/driver/trip — the latest trip, active or completed; null if the driver never departed.
 * Polled while driving; also returned by the request actions below.
 */
export interface DriverTripResponse {
  trip: DriverTrip | null
}

// POST /api/driver/requests/:id/accept   → DriverTripResponse (409 request_not_pending when it timed out or was cancelled)
// POST /api/driver/requests/:id/decline  → DriverTripResponse
// POST /api/driver/requests/:id/board    → DriverTripResponse ("已上車", DD-27; no error if already boarded)
// POST /api/driver/requests/:id/complete → DriverTripResponse ("已下車": end a passenger's ride, DD-23)

// ---------------------------------------------------------------- Proposed: passenger

/** What the passenger is looking for: destination, acceptable stops and filters. */
export interface PassengerSearch {
  destination: Place
  accepted_stop_ids: number[]
  tag_filters: TagFilter[]
}

/**
 * Query of GET /api/passenger/supply (REQ-029, T11): pickup_point_id, destination_name,
 * destination_lat, destination_lng, accepted_stop_ids (comma separated), required_tag_ids and
 * preferred_tag_ids (comma separated, may be empty). 400 when the pickup point, destination or
 * stops are missing.
 */
export interface SupplyQuery extends PassengerSearch {
  pickup_point_id: number
}

/** One approaching vehicle on the timeline. Not selectable (REQ-031). */
export interface SupplyVehicle {
  /** Stable while the vehicle approaches, so the timeline can animate it. */
  id: number
  eta_s: number
  simulated: boolean
}

/** GET /api/passenger/supply — the chosen pickup point's card and timeline, polled while browsing (REQ-029, REQ-030). */
export interface Supply {
  pickup_point: PickupPoint
  wait_limit_min: number
  /** How close to the pickup point a request may be sent (REQ-034). */
  submit_distance_m: number
  vehicle_count: number
  fastest_eta_s: number | null
  seats: number
  /** Within the wait limit, nearest first. */
  vehicles: SupplyVehicle[]
  simulated: boolean
}

/** Body of POST /api/passenger/requests: the search, where to board and where the passenger is now (DD-25). */
export interface RequestSubmission extends SupplyQuery {
  location: LatLngBody
}

export type RequestStatus = 'rejected' | 'waiting_driver' | 'no_match' | 'confirmed' | 'boarded' | 'completed' | 'cancelled'

export interface VehiclePosition {
  lat: number
  lng: number
  /** Degrees clockwise from north; null when unknown (UD-15). */
  heading: number | null
  reported_at: string
}

/** The assigned car, once the driver confirmed. */
export interface Ride {
  vehicle: Vehicle
  /** Seconds until the car reaches the pickup point; null once it has passed or the passenger boarded. */
  eta_s: number | null
  /** Where the passenger gets off: a bus stop on the route, or the driver's destination. */
  dropoff: Place & { bus_stop_id: number | null }
  route: Route
  /** Only while confirmed: the car on its way to the pickup point (UD-15). */
  position: VehiclePosition | null
  passed_pickup: boolean
  simulated: boolean
}

export type Alternative =
  | { mode: 'bus'; route_name: string; board_stop_name: string; alight_stop_name: string; duration_min: number; simulated: boolean }
  | { mode: 'walk'; via: string | null; duration_min: number; simulated: boolean }

export interface PassengerRequest {
  id: number
  status: RequestStatus
  pickup_point: PickupPoint
  destination: Place
  /** A driver declined or timed out and the request moved to the next car (REQ-050). */
  reassigned: boolean
  /** The car does not match all preferred tags (REQ-047). */
  relaxed: boolean
  reject_reason: { code: 'too_far'; message: string; distance_m: number } | null
  /** Set when confirmed, boarded or completed. */
  ride: Ride | null
  /** Set when no_match (REQ-051). */
  alternatives: Alternative[]
  /** Before boarding only (UD-17). */
  can_cancel: boolean
  created_at: string
}

/**
 * GET /api/passenger/request — the latest request, null if none.
 * POST /api/passenger/requests returns it too (201), already decided: rejected, no_match,
 * waiting_driver or confirmed (REQ-036). 409 request_active if one is still open.
 */
export interface PassengerRequestResponse {
  request: PassengerRequest | null
}

// POST /api/passenger/requests/:id/cancel   → PassengerRequestResponse (409 cannot_cancel after boarding)
// POST /api/passenger/requests/:id/board    → PassengerRequestResponse ("我已上車", DD-27; no error if already boarded)
// POST /api/passenger/requests/:id/complete → PassengerRequestResponse ("我已下車，結束共乘"; no error if already done)

// ---------------------------------------------------------------- Demo control

// POST /api/demo/reset → 204. No token: called by the showcase page (UD-18). Both backends.

export type MockScenario = 'normal' | 'reassign' | 'no_cars'

/** GET /api/_mock; POST /api/_mock/scenario { scenario } also resets. Mock backend only. */
export interface MockStatus {
  scenario: MockScenario
  scenarios: MockScenario[]
  /** Virtual clock offset; POST /api/_mock/advance { seconds } moves time forward. */
  clock_offset_s: number
}
