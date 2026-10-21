// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { CurrentRequest, DriverRequests, RequestStatusView, RequestView, Supply, TripDefaults, TripView } from '../../shared/src/api/types.ts'
import { createMockApi } from './api.ts'
import { loadStaticData } from './data/load.ts'

const data = loadStaticData()
const DRIVER = 'Bearer driver:driver4'
const PASSENGER = 'Bearer passenger:passenger1'
const SONGSHAN = { lat: 25.049806, lng: 121.578206 }
/** Metres north of 松山車站, like the passenger debug mode presets (DD-26). */
const near = (m: number) => ({ lat: SONGSHAN.lat + m / 111195, lng: SONGSHAN.lng })
const SEARCH = {
  pickup_point_id: 1,
  destination: { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 },
  stop_ids: [9, 23],
  tag_filters: [],
}
const SUBMIT = { ...SEARCH, location: near(25) }
const SUPPLY = `/api/passenger/supply?pickup_point_id=1&dest_name=${encodeURIComponent('瑞光路 513 巷')}&dest_lat=25.0765&dest_lng=121.5742&stop_ids=9,23&required_tags=&preferred_tags=`
const DEPARTURE = { pickup_point_id: 1, destination: SEARCH.destination, capacity: 3, auto_accept: false, tag_filters: [] }

let api: ReturnType<typeof createMockApi>
let clock = 0

function call(method: string, path: string, authorization?: string, body?: unknown) {
  const [pathname, qs] = path.split('?')
  return api.handle({ method, path: pathname, query: new URLSearchParams(qs), authorization, body })
}
const json = <T,>(method: string, path: string, authorization?: string, body?: unknown) => call(method, path, authorization, body).body as T
const advance = (seconds: number) => call('POST', '/api/_mock/advance', undefined, { seconds })
const scenario = (name: string) => call('POST', '/api/_mock/scenario', undefined, { scenario: name })
const statusOf = (id: number) => json<RequestStatusView>('GET', `/api/passenger/requests/${id}`, PASSENGER)
const current = () => json<CurrentRequest>('GET', '/api/passenger/requests/current', PASSENGER).request
const driverRequests = () => json<DriverRequests>('GET', '/api/driver/requests', DRIVER)
const submit = (body: unknown = SUBMIT) => json<RequestView>('POST', '/api/passenger/requests', PASSENGER, body)

beforeEach(() => {
  clock = Date.parse('2026-10-24T08:12:00+08:00')
  api = createMockApi(data, () => clock)
})

describe('existing endpoints match the Go backend', () => {
  it('identifies the caller like DD-18', () => {
    expect(call('GET', '/api/me', 'Bearer driver:driver1')).toEqual({
      status: 200,
      body: { username: 'driver1', display_name: '駕駛 鐵雄', role: 'driver', roles: ['driver'], simulated: true },
    })
    expect(call('GET', '/api/me').status).toBe(401)
    expect(call('GET', '/api/me', 'Bearer driver:nobody').status).toBe(401)
    expect(call('GET', '/api/me', 'Bearer driver:passenger1')).toMatchObject({ status: 403, body: { error: { code: 'forbidden' } } })
    expect(call('GET', '/api/driver/profile', PASSENGER).status).toBe(403)
    expect(call('GET', '/api/nope', PASSENGER)).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } })
    expect(call('PUT', '/api/driver/profile', DRIVER)).toMatchObject({ status: 405, body: { error: { code: 'method_not_allowed' } } })
  })

  it('serves the seeded reference data with the same ids', () => {
    expect(json<unknown[]>('GET', '/api/pickup-points', PASSENGER)[0]).toEqual({ id: 1, name: '松山車站', lat: 25.049806, lng: 121.578206, radius_m: 80 })
    expect(json<unknown[]>('GET', '/api/bus-stops', PASSENGER)).toHaveLength(97)
    expect(json<unknown[]>('GET', '/api/tags', PASSENGER)[0]).toEqual({ id: 1, name: '不抽菸', issuer: 'self', selected: false })
  })

  it('selects and deselects tags', () => {
    expect(call('PUT', '/api/me/tags/2', PASSENGER).status).toBe(204)
    expect(json<{ id: number; selected: boolean }[]>('GET', '/api/tags', PASSENGER)[1].selected).toBe(true)
    expect(call('DELETE', '/api/me/tags/2', PASSENGER).status).toBe(204)
    expect(call('PUT', '/api/me/tags/abc', PASSENGER).status).toBe(400)
    expect(call('PUT', '/api/me/tags/99999999', PASSENGER).status).toBe(404)
  })
})

describe('trips, activities and positions match the Go backend', () => {
  it('departs with the Go trip shape, once at a time, and prefills from the last departure', () => {
    const departed = call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    expect(departed.status).toBe(201)
    const trip = departed.body as TripView
    expect(trip).toMatchObject({ status: 'active', capacity: 3, seats_available: 3, settings_locked: true, pickup_point: { name: '松山車站' } })
    expect(trip.route?.bus_stops.length).toBeGreaterThan(0)
    expect(call('POST', '/api/driver/trips', DRIVER, DEPARTURE)).toMatchObject({ status: 409, body: { error: { code: 'already_active' } } })
    expect(json<TripView>('GET', '/api/driver/trips/current', DRIVER).id).toBe(trip.id)
    expect(call('GET', '/api/driver/trips/current', 'Bearer driver:driver5').status).toBe(404)
    expect(json<TripDefaults>('GET', '/api/driver/trips/defaults', 'Bearer driver:driver5')).toEqual({
      pickup_point_id: null,
      destination: null,
      capacity: null,
      auto_accept: false,
      tag_filters: [],
    })
    expect(call('POST', '/api/driver/trips', DRIVER, { ...DEPARTURE, destination: { name: '台北101', lat: 25.0339, lng: 121.5645 } })).toMatchObject({
      status: 400,
      body: { error: { code: 'destination_outside_park' } },
    })
  })

  it('checks the park and previews the route like the Go backend, without a places search (DD-32, DD-21)', () => {
    expect(json('GET', '/api/park/check?lat=25.0765&lng=121.5742', PASSENGER)).toEqual({ inside: true })
    expect(json('GET', '/api/park/check?lat=25.0339&lng=121.5645', DRIVER)).toEqual({ inside: false })
    expect(call('GET', '/api/park/check?lat=91&lng=121', DRIVER)).toMatchObject({ status: 400, body: { error: { code: 'invalid_location' } } })
    expect(call('GET', '/api/park/check?lng=121', DRIVER)).toMatchObject({ status: 400, body: { error: { code: 'invalid_location' } } })
    expect(call('GET', '/api/places?q=瑞光', DRIVER).status).toBe(404)

    // The preview needs only a position, and is the route a departure gets.
    const preview = json<{ route: TripView['route'] }>('POST', '/api/driver/route-preview', DRIVER, { pickup_point_id: 1, destination: { lat: 25.0765, lng: 121.5742 } })
    expect(preview.route?.bus_stops.length).toBeGreaterThan(0)
    expect(json<TripView>('POST', '/api/driver/trips', DRIVER, DEPARTURE).route).toEqual(preview.route)
    expect(call('POST', '/api/driver/route-preview', DRIVER, { pickup_point_id: 1, destination: { lat: 25.0339, lng: 121.5645 } })).toMatchObject({
      status: 400,
      body: { error: { code: 'destination_outside_park' } },
    })
  })

  it('departs on a saved preview once, like the Go backend (T26, DD-21)', () => {
    const at = { lat: DEPARTURE.destination.lat, lng: DEPARTURE.destination.lng }
    const preview = (who = DRIVER, pickup = 1) => json<{ preview_id: number }>('POST', '/api/driver/route-preview', who, { pickup_point_id: pickup, destination: at }).preview_id
    const refused = { status: 400, body: { error: { code: 'invalid_route_preview' } } }
    const other = 'Bearer driver:driver5'

    // Someone else's preview, another pickup point, an unknown one: refused, and no trip is made.
    expect(call('POST', '/api/driver/trips', DRIVER, { ...DEPARTURE, preview_id: preview(other) })).toMatchObject(refused)
    expect(call('POST', '/api/driver/trips', DRIVER, { ...DEPARTURE, preview_id: preview(DRIVER, 2) })).toMatchObject(refused)
    expect(call('POST', '/api/driver/trips', DRIVER, { ...DEPARTURE, preview_id: 999 })).toMatchObject(refused)
    expect(call('GET', '/api/driver/trips/current', DRIVER).status).toBe(404)

    // The name may differ; the position may not.
    const id = preview()
    expect(call('POST', '/api/driver/trips', DRIVER, { ...DEPARTURE, destination: { ...DEPARTURE.destination, name: '別的名字' }, preview_id: id }).status).toBe(201)
    call('POST', '/api/demo/reset')
    // Used once: refused the second time.
    expect(call('POST', '/api/driver/trips', DRIVER, { ...DEPARTURE, preview_id: id })).toMatchObject(refused)
    // A failed departure leaves the preview unused.
    const fresh = preview()
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    expect(call('POST', '/api/driver/trips', DRIVER, { ...DEPARTURE, preview_id: fresh }).status).toBe(409)
    call('POST', '/api/demo/reset')
    expect(call('POST', '/api/driver/trips', DRIVER, { ...DEPARTURE, preview_id: fresh }).status).toBe(201)
  })

  it('accepts positions only after taking part (DD-25)', () => {
    expect(call('POST', '/api/location', PASSENGER, SONGSHAN)).toMatchObject({ status: 409, body: { error: { code: 'no_activity' } } })
    expect(call('POST', '/api/activities', PASSENGER)).toMatchObject({ status: 201, body: { role: 'passenger', trip_id: null } })
    expect(call('POST', '/api/location', PASSENGER, SONGSHAN)).toMatchObject({ status: 201, body: SONGSHAN })
    expect(call('POST', '/api/location', PASSENGER, { lat: 91, lng: 0 }).status).toBe(400)
    expect(call('POST', '/api/activities', 'Bearer driver:driver5')).toMatchObject({ status: 409, body: { error: { code: 'no_active_trip' } } })
    expect(call('POST', '/api/location', 'Bearer driver:driver1', SONGSHAN).status).toBe(201)
  })

  it('decides passed_pickup from the driver’s reports like the Go backend (DD-06)', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    const report = (m: number) => json<{ passed_pickup: boolean }>('POST', '/api/location', DRIVER, near(m)).passed_pickup
    // Beyond the area without having entered it: not passed.
    expect(report(-300)).toBe(false)
    expect(report(300)).toBe(false)
    expect(report(40)).toBe(false)
    // Inside the leave margin (radius 80 + margin 25): still not passed.
    expect(report(100)).toBe(false)
    expect(report(120)).toBe(true)
    expect(report(0)).toBe(true)
    expect(json<TripView>('GET', '/api/driver/trips/current', DRIVER).passed_pickup).toBe(true)
  })
})

describe('request flow matches the Go backend (T11-T13)', () => {
  it('normal: the driver on stage confirms; the passenger boards and ends the ride', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    const submitted = call('POST', '/api/passenger/requests', PASSENGER, SUBMIT)
    expect(submitted).toMatchObject({ status: 201, body: { status: 'waiting_driver', pickup_point_id: 1, submitted_lat: near(25).lat } })
    const id = (submitted.body as RequestView).id
    expect(current()).toMatchObject({ id, status: 'waiting_driver', reassigned_count: 0, vehicle: null, trip: null, vehicle_position: null, passed_pickup: null, eta_simulated: null })

    const pending = driverRequests().pending
    expect(pending).toEqual([expect.objectContaining({ id, passenger_name: '乘客 小美', pickup_point: expect.objectContaining({ name: '松山車站' }), boarded: false })])
    expect(pending[0].dropoff.name).toBeTruthy()
    expect(json<RequestView>('POST', `/api/driver/requests/${id}/accept`, DRIVER)).toMatchObject({ id, status: 'confirmed' })
    expect(call('POST', `/api/driver/requests/${id}/accept`, DRIVER)).toMatchObject({ status: 409, body: { error: { code: 'not_waiting' } } })

    const confirmed = statusOf(id)
    expect(confirmed).toMatchObject({ status: 'confirmed', vehicle: { plate: 'ABC-0004', description: '藍色 Mazda 3' }, pickup_point: { name: '松山車站' } })
    expect(confirmed.eta_s).toBeGreaterThan(0)
    // Every mock ETA is simulated; the car's position and heading as DD-31 names them.
    expect(confirmed).toMatchObject({ eta_simulated: true, passed_pickup: false, vehicle_position: { heading_deg: expect.any(Number), reported_at: expect.any(String) } })
    expect(confirmed.trip?.route?.bus_stops.length).toBeGreaterThan(0)
    expect(driverRequests()).toMatchObject({ pending: [], passengers: [expect.objectContaining({ id, status: 'confirmed', boarded: false })] })

    expect(json<RequestView>('POST', `/api/passenger/requests/${id}/board`, PASSENGER)).toMatchObject({ status: 'boarded' })
    // After boarding the pickup, car, ETA and trip are gone (DD-27, REQ-068).
    expect(statusOf(id)).toMatchObject({ status: 'boarded', vehicle: null, eta_s: null, eta_simulated: null, vehicle_position: null, trip: null, trip_id: confirmed.trip_id })
    expect(driverRequests().passengers[0].boarded).toBe(true)
    expect(call('POST', `/api/driver/requests/${id}/board`, DRIVER)).toMatchObject({ status: 200, body: { status: 'boarded' } })

    call('POST', `/api/passenger/requests/${id}/complete`, PASSENGER)
    expect(statusOf(id).status).toBe('completed')
    expect(current()).toBeNull()
    expect(call('POST', `/api/driver/requests/${id}/complete`, DRIVER)).toMatchObject({ status: 200, body: { status: 'completed' } })
    expect(call('POST', `/api/driver/requests/${id}/board`, DRIVER)).toMatchObject({ status: 409, body: { error: { code: 'invalid_state' } } })
    expect(driverRequests().passengers).toEqual([])
  })

  it('either side may end a ride without marking boarding first (DD-27)', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    const { id } = submit()
    call('POST', `/api/driver/requests/${id}/accept`, DRIVER)
    call('POST', `/api/driver/requests/${id}/complete`, DRIVER)
    expect(statusOf(id).status).toBe('completed')
  })

  it('only the owner reads a request', () => {
    const { id } = submit()
    expect(call('GET', `/api/passenger/requests/${id}`, 'Bearer passenger:passenger2')).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } })
  })

  it('auto-accept: the request still waits until the client confirms (DD-33)', () => {
    call('POST', '/api/driver/trips', DRIVER, { ...DEPARTURE, auto_accept: true })
    const { id, status } = submit()
    expect(status).toBe('waiting_driver')
    expect(statusOf(id)).toMatchObject({ status: 'waiting_driver', vehicle: null })
    expect(driverRequests()).toMatchObject({ pending: [expect.objectContaining({ id })], passengers: [] })

    // The driver UI sends the same confirm as the 確認 button; a second one is 409 not_waiting.
    expect(json<RequestView>('POST', `/api/driver/requests/${id}/accept`, DRIVER)).toMatchObject({ id, status: 'confirmed' })
    expect(call('POST', `/api/driver/requests/${id}/accept`, DRIVER)).toMatchObject({ status: 409, body: { error: { code: 'not_waiting' } } })
    expect(statusOf(id)).toMatchObject({ status: 'confirmed', vehicle: { plate: 'ABC-0004' } })
  })

  it('reassign: the driver times out; the simulated car waits for the simulator to confirm (DD-14, DD-33)', () => {
    scenario('reassign')
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    const { id } = submit()
    advance(16)
    expect(driverRequests().pending).toEqual([])
    const reassigned = statusOf(id)
    expect(reassigned).toMatchObject({ status: 'waiting_driver', reassigned_count: 1 })

    // The seeded trip auto-accepts, but only once its account confirms, as the simulator does.
    const simulated = ['driver1', 'driver2', 'driver3']
      .map((name) => `Bearer driver:${name}`)
      .find((auth) => json<DriverRequests>('GET', '/api/driver/requests', auth).trip_id === reassigned.trip_id)!
    expect(json<TripView>('GET', '/api/driver/trips/current', simulated).auto_accept).toBe(true)
    expect(json<DriverRequests>('GET', '/api/driver/requests', simulated).pending).toEqual([expect.objectContaining({ id })])
    call('POST', `/api/driver/requests/${id}/accept`, simulated)
    expect(statusOf(id)).toMatchObject({ status: 'confirmed', reassigned_count: 1 })
  })

  it('no_cars: answers at once that there is no car, without alternatives (REQ-036)', () => {
    scenario('no_cars')
    expect(json<Supply>('GET', SUPPLY, PASSENGER)).toMatchObject({ card: { count: 0, fastest_eta_s: null, fastest_eta_simulated: null }, cars: [], pickup_point: { id: 1 } })
    const request = submit()
    expect(request).toMatchObject({ status: 'no_match', trip_id: null })
    expect(statusOf(request.id)).toMatchObject({ reason: 'no_match', message: '目前沒有可搭的車' })
  })

  it('too far: the position sent with the request is checked (REQ-034, DD-25)', () => {
    expect(submit({ ...SUBMIT, location: near(420) })).toMatchObject({ status: 'rejected', reason: 'too_far', message: expect.stringContaining('420 公尺') })
    expect(submit({ ...SUBMIT, location: near(195) }).status).not.toBe('rejected')
    expect(call('POST', '/api/passenger/requests', PASSENGER, SEARCH)).toMatchObject({ status: 400, body: { error: { code: 'invalid_location' } } })
  })

  it('supply covers the chosen pickup point only, with the habitual data as fallback (REQ-029, REQ-025)', () => {
    const supply = json<Supply>('GET', SUPPLY, PASSENGER)
    expect(supply).toMatchObject({ pickup_point: { name: '松山車站' }, card: { count: 3 }, timeline_range_s: 600, accepted_stop_ids: [9, 23] })
    expect(supply.cars.map((c) => c.eta_s)).toEqual([...supply.cars.map((c) => c.eta_s)].sort((a, b) => a - b))
    expect(supply.card.seats_remaining).toBe(supply.cars.reduce((sum, c) => sum + c.seats_available, 0))
    expect(supply.card.fastest_eta_simulated).toBe(true)
    expect(supply.cars.every((c) => c.eta_simulated)).toBe(true)
    expect(json<Supply>('GET', SUPPLY.replace('pickup_point_id=1', 'pickup_point_id=2'), PASSENGER).card.count).toBe(0)
    expect(call('GET', SUPPLY.replace('pickup_point_id=1&', ''), PASSENGER)).toMatchObject({ status: 400, body: { error: { code: 'invalid_request' } } })
    expect(call('GET', SUPPLY.replace('stop_ids=9,23', 'stop_ids=99999'), PASSENGER)).toMatchObject({ status: 400, body: { error: { code: 'invalid_stop' } } })
    // passenger1 has habitual data; passenger2 does not.
    expect(json<Supply>('GET', '/api/passenger/supply?pickup_point_id=1', PASSENGER).destination.name).toBe('瑞光路 513 巷')
    expect(call('GET', '/api/passenger/supply?pickup_point_id=1', 'Bearer passenger:passenger2')).toMatchObject({ status: 400, body: { error: { code: 'destination_required' } } })
  })

  it('the trip ends by itself at the destination and finishes the rides on board (UD-16)', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    const { id } = submit()
    call('POST', `/api/driver/requests/${id}/accept`, DRIVER)
    call('POST', `/api/passenger/requests/${id}/board`, PASSENGER)
    const tripId = statusOf(id).trip_id!
    expect(json<TripView>('GET', `/api/trips/${tripId}`, DRIVER)).toMatchObject({ status: 'active', ended_at: null, completed_rides: 0 })
    advance(3600)
    expect(driverRequests()).toEqual({ trip_id: null, pending: [], passengers: [] })
    expect(statusOf(id).status).toBe('completed')
    // Like the Go backend after T21: the ended trip carries its finished rides, and reports say it ended.
    expect(json<TripView>('GET', `/api/trips/${tripId}`, DRIVER)).toMatchObject({ status: 'completed', ended_at: expect.any(String), completed_rides: 1 })
    expect(json<{ trip_ended: boolean }>('POST', '/api/location', DRIVER, SONGSHAN).trip_ended).toBe(true)
  })

  it('moves driver2’s destination like the Go seed does (T03, T23)', () => {
    expect(data.seed.simulatedTrips.find((t) => t.username === 'driver2')?.destination).toEqual({ name: '瑞光路 內科大樓 B', lat: 25.079, lng: 121.569 })
  })

  it('reset clears trips and requests but keeps the simulated trips', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    expect(call('POST', '/api/demo/reset').status).toBe(204)
    expect(driverRequests().trip_id).toBeNull()
    expect(json<Supply>('GET', SUPPLY, PASSENGER).card.count).toBe(3)
  })
})
