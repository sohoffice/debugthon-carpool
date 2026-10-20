// API shapes shared by the apps and the mock backend (docs/ui-design.md 10.1, UD-14).
// "Existing" types mirror the Go backend on main exactly (DEV.md); "Proposed" types cover APIs
// the Go backend does not have yet and switch to its format once their ticket lands.
// All field names are snake_case like Go.
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

/** A passenger's drop-off: a bus stop along the route, or the trip's destination when bus_stop_id is null. */
export interface Dropoff {
  bus_stop_id: number | null
  name: string
  lat: number
  lng: number
}

/** One request on the driver's running trip (T13). */
export interface DriverRequestItem {
  id: number
  status: 'waiting_driver' | 'confirmed' | 'boarded'
  passenger_name: string
  pickup_point: PickupPoint
  dropoff: Dropoff
  relaxed: boolean
  /** Not shown: the driver sees no countdown (ui-oi-02). */
  response_deadline_at: string | null
  /** Marked by either side (DD-27, REQ-068). */
  boarded: boolean
  boarded_at: string | null
}

/**
 * GET /api/driver/requests — polled while driving (REQ-049, REQ-066). trip_id is null and both
 * lists are empty when the driver has no running trip.
 */
export interface DriverRequests {
  trip_id: number | null
  /** Waiting for this driver's answer. */
  pending: DriverRequestItem[]
  /** Confirmed or boarded. */
  passengers: DriverRequestItem[]
}

// POST /api/driver/requests/:id/accept   → RequestView (409 not_waiting once answered or timed out)
// POST /api/driver/requests/:id/decline  → RequestView (409 not_waiting)
// POST /api/driver/requests/:id/board    → RequestView ("已上車", DD-27; 409 invalid_state unless confirmed or boarded)
// POST /api/driver/requests/:id/complete → RequestView ("已下車", DD-23; 409 invalid_state)

/** One car the passenger could be assigned at the pickup point. Not selectable (REQ-031). */
export interface SupplyCar {
  trip_id: number
  eta_s: number
  /** The ETA comes from the simulated route fallback (REQ-063, DD-09). */
  eta_simulated: boolean
  seats_available: number
}

/**
 * GET /api/passenger/supply (T11, REQ-029, REQ-030). Query: pickup_point_id (required),
 * dest_lat + dest_lng (+ dest_name), stop_ids, required_tags, preferred_tags (ids, comma
 * separated); destination and stops fall back to the passenger's habitual data.
 */
export interface Supply {
  pickup_point: PickupPoint
  destination: Place
  accepted_stop_ids: number[]
  /** fastest_eta_simulated is null without a car (REQ-063). */
  card: { count: number; fastest_eta_s: number | null; fastest_eta_simulated: boolean | null; seats_remaining: number }
  /** The wait limit: the timeline runs from now to then (REQ-030). */
  timeline_range_s: number
  /** Soonest first. */
  cars: SupplyCar[]
}

/**
 * Body of POST /api/passenger/requests (T12): where to board and where the passenger is now
 * (DD-25). Destination and stops fall back to the habitual data.
 */
export interface RequestSubmission {
  pickup_point_id: number
  location: LatLngBody
  destination?: Place
  stop_ids?: number[]
  tag_filters?: TagFilter[]
}

export type RequestStatus = 'rejected' | 'waiting_driver' | 'no_match' | 'confirmed' | 'boarded' | 'completed'

/**
 * A ride request: POST /api/passenger/requests (201, already decided: rejected, no_match,
 * waiting_driver or confirmed, REQ-036) and every request action. The backend does not refuse a
 * second open request; the UI does (REQ-069).
 */
export interface RequestView {
  id: number
  status: RequestStatus
  /** too_far when rejected, no_match when no car. */
  reason: string | null
  message: string | null
  /** The car does not match all preferred tags (REQ-047). */
  relaxed: boolean
  pickup_point_id: number
  submitted_lat: number
  submitted_lng: number
  trip_id: number | null
  /** Null: the trip's destination. */
  dropoff_bus_stop_id: number | null
  response_deadline_at: string | null
  confirmed_at: string | null
  boarded_at: string | null
  completed_at: string | null
  created_at: string
}

// ---------------------------------------------------------------- Request status

/** The assigned car's latest report (DD-31). */
export interface VehiclePosition {
  lat: number
  lng: number
  /** Degrees clockwise from north, from the last two different reports; null after only one (UD-15, DD-31). */
  heading_deg: number | null
  reported_at: string
}

/**
 * GET /api/passenger/requests/:id — polled (REQ-052, REQ-053). pickup_point, vehicle, eta_s and
 * trip are set only while confirmed (DD-27). GET /api/passenger/requests/current returns
 * { request } with the open one (waiting, confirmed or boarded), or null (REQ-069).
 */
export interface RequestStatusView extends RequestView {
  /** Drivers that declined or timed out (REQ-053). */
  reassigned_count: number
  pickup_point: PickupPoint | null
  vehicle: Vehicle | null
  /** Null until the car has reported a position, and once it has passed the pickup point. */
  eta_s: number | null
  /** The ETA comes from the simulated route fallback; null without an ETA (REQ-063). */
  eta_simulated: boolean | null
  trip: TripView | null
  /** Null before the car's first report, and unless confirmed (DD-31). */
  vehicle_position: VehiclePosition | null
  /** Whether the car has passed the pickup point; null unless confirmed (DD-31, DD-06). */
  passed_pickup: boolean | null
}

export interface CurrentRequest {
  request: RequestStatusView | null
}

// POST /api/passenger/requests/:id/board    → RequestView ("我已上車", DD-27; already boarded is fine)
// POST /api/passenger/requests/:id/complete → RequestView ("我已下車，結束共乘", DD-23; already done is fine)

// ---------------------------------------------------------------- Destinations (DD-32, DD-21)

/**
 * GET /api/park/check?lat=&lng= — whether a place chosen with Google Places is inside the park
 * (DD-32). 400 invalid_location for a bad coordinate.
 */
export interface ParkCheck {
  inside: boolean
}

/** Body of POST /api/driver/route-preview; 400 destination_outside_park (DD-21, T20). */
export interface RoutePreviewRequest {
  pickup_point_id: number
  destination: LatLngBody
}

/** POST /api/driver/route-preview: the same route a departure to this destination would get. */
export interface RoutePreview {
  route: Route
}

// ---------------------------------------------------------------- UI state (not an API shape)

/** What the passenger is looking for; kept by the passenger UI and by the mock backend. */
export interface PassengerSearch {
  destination: Place
  accepted_stop_ids: number[]
  tag_filters: TagFilter[]
}

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
