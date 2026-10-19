// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { DriverTripResponse, PassengerRequestResponse, Supply } from '../../shared/src/api/types.ts'
import { createMockApi } from './api.ts'
import { loadStaticData } from './data/load.ts'

const data = loadStaticData()
const DRIVER = 'Bearer driver:driver4'
const PASSENGER = 'Bearer passenger:passenger1'
const SEARCH = {
  destination: { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 },
  accepted_stop_ids: [9, 23],
  tag_filters: [],
}
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

beforeEach(() => {
  clock = Date.parse('2026-10-24T08:12:00+08:00')
  api = createMockApi(data, () => clock)
})

describe('existing endpoints match the Go backend', () => {
  it('identifies the caller like DD-18', () => {
    expect(call('GET', '/api/me', 'Bearer driver:driver1')).toEqual({
      status: 200,
      body: { username: 'driver1', display_name: '駕駛 阿明', role: 'driver', roles: ['driver'], simulated: true },
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

describe('demo flow', () => {
  it('normal: request goes to the driver on stage, who confirms; either side ends the ride', () => {
    expect(call('POST', '/api/driver/trips', DRIVER, DEPARTURE).status).toBe(201)
    const submitted = json<PassengerRequestResponse>('POST', '/api/passenger/requests', PASSENGER, SEARCH).request!
    expect(submitted.status).toBe('waiting_driver')

    const pending = myTrip().pending_request!
    expect(pending.pickup_point.name).toBe('松山車站')
    call('POST', `/api/driver/requests/${pending.id}/accept`, DRIVER)

    const confirmed = myRequest()
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.ride?.vehicle.plate).toBe('BEN-0824')
    expect(confirmed.ride?.eta_s).toBeGreaterThan(0)
    expect(myTrip().passengers).toHaveLength(1)

    call('POST', `/api/passenger/requests/${submitted.id}/complete`, PASSENGER)
    expect(myRequest().status).toBe('completed')
    expect(call('POST', `/api/driver/requests/${submitted.id}/complete`, DRIVER).status).toBe(200)
    expect(myTrip()).toMatchObject({ passengers: [], completed_count: 1 })
  })

  it('reassign: the driver times out and a simulated car auto-accepts', () => {
    scenario('reassign')
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    call('POST', '/api/passenger/requests', PASSENGER, SEARCH)
    advance(16)
    expect(myTrip().pending_request).toBeNull()
    expect(myRequest()).toMatchObject({ status: 'confirmed', reassigned: true })
  })

  it('no_cars: answers at once with alternatives', () => {
    scenario('no_cars')
    const supply = json<Supply>('POST', '/api/passenger/supply', PASSENGER, SEARCH)
    expect(supply.cards[0].vehicle_count).toBe(0)
    const request = json<PassengerRequestResponse>('POST', '/api/passenger/requests', PASSENGER, SEARCH).request!
    expect(request.status).toBe('no_match')
    expect(request.alternatives.some((a) => a.mode === 'bus')).toBe(true)
    expect(request.alternatives.at(-1)?.mode).toBe('walk')
  })

  it('too_far: the request is rejected with the distance', () => {
    scenario('too_far')
    expect(json<Supply>('POST', '/api/passenger/supply', PASSENGER, SEARCH).location).toMatchObject({ distance_m: 420, within_submit_distance: false })
    const request = json<PassengerRequestResponse>('POST', '/api/passenger/requests', PASSENGER, SEARCH).request!
    expect(request).toMatchObject({ status: 'rejected', reject_reason: { code: 'too_far', distance_m: 420 } })
  })

  it('cancel before boarding releases the driver, and is refused after the car passed the pickup', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    const first = json<PassengerRequestResponse>('POST', '/api/passenger/requests', PASSENGER, SEARCH).request!
    call('POST', `/api/passenger/requests/${first.id}/cancel`, PASSENGER)
    expect(myTrip().pending_request).toBeNull()

    const second = json<PassengerRequestResponse>('POST', '/api/passenger/requests', PASSENGER, SEARCH).request!
    call('POST', `/api/driver/requests/${second.id}/accept`, DRIVER)
    advance(300)
    expect(myRequest()).toMatchObject({ can_cancel: false, ride: { passed_pickup: true, eta_s: null } })
    expect(call('POST', `/api/passenger/requests/${second.id}/cancel`, PASSENGER).status).toBe(409)
  })

  it('the trip ends by itself at the destination and finishes the rides on board (UD-16)', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    const request = json<PassengerRequestResponse>('POST', '/api/passenger/requests', PASSENGER, SEARCH).request!
    call('POST', `/api/driver/requests/${request.id}/accept`, DRIVER)
    advance(3600)
    expect(myTrip()).toMatchObject({ status: 'completed', completed_count: 1 })
    expect(myRequest().status).toBe('completed')
  })

  it('reset clears trips and requests but keeps the simulated trips', () => {
    call('POST', '/api/driver/trips', DRIVER, DEPARTURE)
    expect(call('POST', '/api/demo/reset').status).toBe(204)
    expect(myTrip()).toMatchObject({ id: 4, status: 'completed' })
    expect(json<Supply>('POST', '/api/passenger/supply', PASSENGER, SEARCH).cards[0].vehicle_count).toBe(3)
  })
})
