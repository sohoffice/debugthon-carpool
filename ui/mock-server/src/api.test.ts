// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { DriverTripResponse, PassengerRequestResponse, Supply, TripDefaults, TripView } from '../../shared/src/api/types.ts'
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
  accepted_stop_ids: [9, 23],
  tag_filters: [],
}
const SUBMIT = { ...SEARCH, location: near(25) }
const SUPPLY = `/api/passenger/supply?pickup_point_id=1&destination_name=${encodeURIComponent('瑞光路 513 巷')}&destination_lat=25.0765&destination_lng=121.5742&accepted_stop_ids=9,23&required_tag_ids=&preferred_tag_ids=`
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
const myRequest = () => json<PassengerRequestResponse>('GET', '/api/passenger/request', PASSENGER).request!
const myTrip = () => json<DriverTripResponse>('GET', '/api/driver/trip', DRIVER).trip!
const submit = (body: unknown = SUBMIT) => json<PassengerRequestResponse>('POST', '/api/passenger/requests', PASSENGER, body).request!

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

  it('accepts positions only after taking part (DD-25)', () => {
    expect(call('POST', '/api/location', PASSENGER, SONGSHAN)).toMatchObject({ status: 409, body: { error: { code: 'no_activity' } } })
    expect(call('POST', '/api/activities', PASSENGER)).toMatchObject({ status: 201, body: { role: 'passenger', trip_id: null } })
    expect(call('POST', '/api/location', PASSENGER, SONGSHAN)).toMatchObject({ status: 201, body: SONGSHAN })
    expect(call('POST', '/api/location', PASSENGER, { lat: 91, lng: 0 }).status).toBe(400)
    expect(call('POST', '/api/activities', 'Bearer driver:driver5')).toMatchObject({ status: 409, body: { error: { code: 'no_active_trip' } } })
    expect(call('POST', '/api/location', 'Bearer driver:driver1', SONGSHAN).status).toBe(201)
  })
})

describe('demo flow', () => {
  it('normal: the driver on stage confirms; the passenger boards and ends the ride', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    const submitted = submit()
    expect(submitted.status).toBe('waiting_driver')

    const pending = myTrip().pending_request!
    expect(pending.pickup_point.name).toBe('松山車站')
    call('POST', `/api/driver/requests/${pending.id}/accept`, DRIVER)

    const confirmed = myRequest()
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.ride?.vehicle).toEqual({ plate: 'DEF-4567', description: '藍色 Mazda 3' })
    expect(confirmed.ride?.eta_s).toBeGreaterThan(0)
    expect(myTrip().passengers).toEqual([expect.objectContaining({ request_id: submitted.id, boarded: false })])

    call('POST', `/api/passenger/requests/${submitted.id}/board`, PASSENGER)
    expect(myRequest()).toMatchObject({ status: 'boarded', can_cancel: false, ride: { eta_s: null, position: null } })
    expect(myTrip().passengers[0].boarded).toBe(true)
    expect(call('POST', `/api/driver/requests/${submitted.id}/board`, DRIVER).status).toBe(200)
    expect(call('POST', `/api/passenger/requests/${submitted.id}/cancel`, PASSENGER)).toMatchObject({ status: 409, body: { error: { code: 'cannot_cancel' } } })

    call('POST', `/api/passenger/requests/${submitted.id}/complete`, PASSENGER)
    expect(myRequest().status).toBe('completed')
    expect(call('POST', `/api/driver/requests/${submitted.id}/complete`, DRIVER).status).toBe(200)
    expect(myTrip()).toMatchObject({ passengers: [], completed_count: 1 })
  })

  it('either side may end a ride without marking boarding first (DD-27)', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    const request = submit()
    call('POST', `/api/driver/requests/${request.id}/accept`, DRIVER)
    call('POST', `/api/driver/requests/${request.id}/complete`, DRIVER)
    expect(myRequest().status).toBe('completed')
  })

  it('reassign: the driver times out and a simulated car auto-accepts', () => {
    scenario('reassign')
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    submit()
    advance(16)
    expect(myTrip().pending_request).toBeNull()
    expect(myRequest()).toMatchObject({ status: 'confirmed', reassigned: true })
  })

  it('no_cars: answers at once with alternatives', () => {
    scenario('no_cars')
    expect(json<Supply>('GET', SUPPLY, PASSENGER)).toMatchObject({ vehicle_count: 0, fastest_eta_s: null, pickup_point: { id: 1 } })
    const request = submit()
    expect(request.status).toBe('no_match')
    expect(request.alternatives.some((a) => a.mode === 'bus')).toBe(true)
    expect(request.alternatives.at(-1)?.mode).toBe('walk')
  })

  it('too far: the position sent with the request is checked (REQ-034, DD-25)', () => {
    const request = submit({ ...SUBMIT, location: near(420) })
    expect(request).toMatchObject({ status: 'rejected', reject_reason: { code: 'too_far', distance_m: 420 } })
  })

  it('supply covers the chosen pickup point only and needs its inputs (REQ-029)', () => {
    const supply = json<Supply>('GET', SUPPLY, PASSENGER)
    expect(supply).toMatchObject({ pickup_point: { name: '松山車站' }, vehicle_count: 3, wait_limit_min: 10, submit_distance_m: 200 })
    expect(supply.vehicles.map((v) => v.eta_s)).toEqual([...supply.vehicles.map((v) => v.eta_s)].sort((a, b) => a - b))
    expect(json<Supply>('GET', SUPPLY.replace('pickup_point_id=1', 'pickup_point_id=2'), PASSENGER).vehicle_count).toBe(0)
    expect(call('GET', SUPPLY.replace('pickup_point_id=1&', ''), PASSENGER).status).toBe(400)
    expect(call('GET', SUPPLY.replace('accepted_stop_ids=9,23', 'accepted_stop_ids='), PASSENGER).status).toBe(400)
  })

  it('cancel before boarding releases the driver, and is refused after the car passed the pickup', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    const first = submit()
    call('POST', `/api/passenger/requests/${first.id}/cancel`, PASSENGER)
    expect(myTrip().pending_request).toBeNull()

    const second = submit()
    call('POST', `/api/driver/requests/${second.id}/accept`, DRIVER)
    advance(300)
    expect(myRequest()).toMatchObject({ can_cancel: false, ride: { passed_pickup: true, eta_s: null } })
    expect(call('POST', `/api/passenger/requests/${second.id}/cancel`, PASSENGER).status).toBe(409)
  })

  it('the trip ends by itself at the destination and finishes the rides on board (UD-16)', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    const request = submit()
    call('POST', `/api/driver/requests/${request.id}/accept`, DRIVER)
    call('POST', `/api/passenger/requests/${request.id}/board`, PASSENGER)
    advance(3600)
    expect(myTrip()).toMatchObject({ status: 'completed', completed_count: 1 })
    expect(myRequest().status).toBe('completed')
  })

  it('reset clears trips and requests but keeps the simulated trips', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    expect(call('POST', '/api/demo/reset').status).toBe(204)
    expect(myTrip()).toMatchObject({ id: 4, status: 'completed' })
    expect(json<Supply>('GET', SUPPLY, PASSENGER).vehicle_count).toBe(3)
  })
})
