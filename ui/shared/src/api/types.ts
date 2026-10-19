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

// ---------------------------------------------------------------- Proposed: shared

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
  /** Bus stops along the route, in travel order. */
  stops: BusStop[]
  /** True when the route is estimated rather than from a routing service (REQ-063). */
  simulated: boolean
}

/** GET /api/places?q=… — destinations inside the park, for the address field. */
export type PlaceSearchResult = Place[]

// ---------------------------------------------------------------- Proposed: driver

/** Body of POST /api/driver/trips ("我出發了") and POST /api/driver/route-preview. */
export interface DepartureSettings {
  pickup_point_id: number
  destination: Place
  capacity: number
  auto_accept: boolean
  tag_filters: TagFilter[]
}

/** Body of POST /api/driver/route-preview; returns Route. */
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
}

export type TripStatus = 'active' | 'completed'

export interface DriverTrip {
  id: number
  status: TripStatus
  pickup_point: PickupPoint
  destination: Place
  capacity: number
  auto_accept: boolean
  tag_filters: TagFilter[]
  route: Route
  started_at: string
  ended_at: string | null
  pending_request: DriverPendingRequest | null
  passengers: DriverPassenger[]
  /** Rides finished on this trip ("今天載了 2 位乘客"). */
  completed_count: number
  simulated: boolean
}

/**
 * GET /api/driver/trip — the latest trip, active or completed; null if the driver never departed.
 * Also returned by POST /api/driver/trips and the request actions below.
 * The last trip's settings prefill the departure screen (REQ-016).
 */
export interface DriverTripResponse {
  trip: DriverTrip | null
}

// POST /api/driver/requests/:id/accept   → DriverTripResponse (409 request_not_pending when it timed out or was cancelled)
// POST /api/driver/requests/:id/decline  → DriverTripResponse
// POST /api/driver/requests/:id/complete → DriverTripResponse ("已下車": end a passenger's ride, DD-23)

// ---------------------------------------------------------------- Proposed: passenger

/** Body of POST /api/passenger/supply and POST /api/passenger/requests. */
export interface PassengerSearch {
  destination: Place
  accepted_stop_ids: number[]
  tag_filters: TagFilter[]
}

/** One approaching vehicle on the timeline. Not selectable (REQ-031). */
export interface SupplyVehicle {
  /** Stable while the vehicle approaches, so the timeline can animate it. */
  id: number
  eta_s: number
  simulated: boolean
}

export interface SupplyCard {
  pickup_point: PickupPoint
  vehicle_count: number
  fastest_eta_s: number | null
  seats: number
  /** Within the wait limit, nearest first. */
  vehicles: SupplyVehicle[]
}

/** POST /api/passenger/supply — polled while browsing (REQ-029, REQ-030). */
export interface Supply {
  wait_limit_min: number
  submit_distance_m: number
  /** Where the passenger is, from the simulator's position reports. */
  location: {
    nearest_pickup_point_id: number
    distance_m: number
    within_submit_distance: boolean
  }
  /** The nearest pickup point first (UD-07), then the others. */
  cards: SupplyCard[]
  simulated: boolean
}

export type RequestStatus = 'rejected' | 'waiting_driver' | 'no_match' | 'confirmed' | 'completed' | 'cancelled'

export interface Vehicle {
  plate: string
  color: string
  model: string
}

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
  /** Seconds until the car reaches the pickup point; null once it has passed. */
  eta_s: number | null
  /** Where the passenger gets off: a bus stop on the route, or the driver's destination. */
  dropoff: Place & { bus_stop_id: number | null }
  route: Route
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
  /** Set when confirmed or completed. */
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
// POST /api/passenger/requests/:id/complete → PassengerRequestResponse ("我已下車，結束共乘")

// ---------------------------------------------------------------- Demo control

// POST /api/demo/reset → 204. No token: called by the showcase page (UD-18). Both backends.

export type MockScenario = 'normal' | 'reassign' | 'no_cars' | 'too_far'

/** GET /api/_mock; POST /api/_mock/scenario { scenario } also resets. Mock backend only. */
export interface MockStatus {
  scenario: MockScenario
  scenarios: MockScenario[]
  /** Virtual clock offset; POST /api/_mock/advance { seconds } moves time forward. */
  clock_offset_s: number
}
