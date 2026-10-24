// @vitest-environment node
import { decodePolyline, distanceM, type RequestStatusView, type TripView } from '@carpool/shared'
import { describe, expect, it } from 'vitest'
import { createMockApi } from '../mock-server/src/api.ts'
import { loadStaticData } from '../mock-server/src/data/load.ts'
import { makePath, pointAt } from '../showcase/src/simulatorPath.ts'
import { SIMULATOR_ROUTES } from '../showcase/src/simulatorRoutes.ts'
import {
  CONFIRM_DELAY_MS,
  detectPassengerStep,
  dueToConfirm,
  PASSENGER_STEPS,
  PICKUP,
  tourRoute,
  TOUR_DRIVERS,
  type PassengerTourState,
} from './passengerTour.ts'

const ARRIVAL_RADIUS_M = 50
const PICKUP_RADIUS_M = 80
const PASS_MARGIN_M = 25

const state = (s: Partial<PassengerTourState>): PassengerTourState => ({ status: null, sheetOpen: false, ...s })

describe('passenger tour steps (T70, DD-46)', () => {
  it('six steps, the last offering the driver tour beside 回到首頁', () => {
    expect(PASSENGER_STEPS.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(PASSENGER_STEPS.every((s) => s.total === 6)).toBe(true)
    expect(PASSENGER_STEPS.slice(0, 5).every((s) => !s.switchTo)).toBe(true)
    expect(PASSENGER_STEPS[5].switchTo).toEqual({ label: '換成駕駛體驗', href: '../driver/index.html' })
  })

  it('names the button to press on the steps the visitor acts on', () => {
    expect(PASSENGER_STEPS[0].text).toContain('「今天我要搭」')
    expect(PASSENGER_STEPS[1].text).toContain('「送出請求」')
    expect(PASSENGER_STEPS[3].text).toContain('「我已上車」')
    expect(PASSENGER_STEPS[4].text).toContain('「我已下車，結束共乘」')
  })

  it('1 供給看板: no request and no sheet', () => {
    expect(detectPassengerStep(state({}))).toBe(0)
  })

  it('2 送出前確認: the submit sheet is open and nothing is sent yet', () => {
    expect(detectPassengerStep(state({ sheetOpen: true }))).toBe(1)
  })

  it('3 等駕駛確認: the request waits for a driver, whatever the page shows', () => {
    expect(detectPassengerStep(state({ status: 'waiting_driver' }))).toBe(2)
    expect(detectPassengerStep(state({ status: 'waiting_driver', sheetOpen: true }))).toBe(2)
  })

  it('4 已確認, 5 已上車, 6 共乘完成 follow the request status', () => {
    expect(detectPassengerStep(state({ status: 'confirmed' }))).toBe(3)
    expect(detectPassengerStep(state({ status: 'boarded' }))).toBe(4)
    expect(detectPassengerStep(state({ status: 'completed' }))).toBe(5)
  })

  it('no car or too far: back to step 1, the board is where to try again', () => {
    expect(detectPassengerStep(state({ status: 'no_match' }))).toBe(0)
    expect(detectPassengerStep(state({ status: 'rejected' }))).toBe(0)
  })
})

// passenger/src/config.ts POLL_INTERVAL_MS; that module reads the page URL on load, so not imported here.
const PASSENGER_POLL_MS = 1000

describe('auto-confirm: the screen is confirmed within about 3 s of 送出請求 (T70, DD-33)', () => {
  it('the delay plus the passenger app\'s poll stays within 3 s', () => {
    expect(CONFIRM_DELAY_MS + PASSENGER_POLL_MS).toBeLessThanOrEqual(3000)
    expect(CONFIRM_DELAY_MS).toBeGreaterThanOrEqual(1500)
  })

  it('not before the delay, then yes', () => {
    expect(dueToConfirm(10_000, 10_000 + CONFIRM_DELAY_MS - 1)).toBe(false)
    expect(dueToConfirm(10_000, 10_000 + CONFIRM_DELAY_MS)).toBe(true)
  })
})

describe('tour routes (T70, T63, T64)', () => {
  it('three to four cars, the seeded simulated drivers, whose trips the tour confirms', () => {
    expect(TOUR_DRIVERS.length).toBeGreaterThanOrEqual(3)
    expect(TOUR_DRIVERS.length).toBeLessThanOrEqual(4)
    expect(TOUR_DRIVERS).toEqual(['driver1', 'driver2', 'driver3'])
  })

  // The mock moves a car by projecting its reports onto the trip's own path (followReports). After the
  // pickup the tour route has to be that path, or the car sticks at the pickup (#217 review: driver2).
  const tripOf = (name: string) => {
    const api = createMockApi(loadStaticData(), Date.now, { followReports: true })
    const r = api.handle({ method: 'GET', path: '/api/driver/trips/current', query: new URLSearchParams(), authorization: `Bearer driver:${name}`, body: undefined })
    return r.body as TripView
  }

  for (const name of TOUR_DRIVERS) {
    it(`${name}: the showcase approach, then the trip's own route cut short of its end; parked, then two fast-forwards`, () => {
      const trip = tripOf(name)
      const onward = decodePolyline(trip.route!.polyline)
      const route = tourRoute(SIMULATOR_ROUTES[name], onward)
      const path = makePath(route.path)
      const full = makePath(SIMULATOR_ROUTES[name].path)
      const pickupIndex = SIMULATOR_ROUTES[name].path.findIndex(([lat, lng]) => lat === PICKUP.lat && lng === PICKUP.lng)
      const pickupM = full.cumulative[pickupIndex]

      // Same streets as the showcase up to the pickup.
      expect(route.path.slice(0, pickupIndex + 1)).toEqual(SIMULATOR_ROUTES[name].path.slice(0, pickupIndex + 1))
      // Then every report lies on the trip's route: within a few metres of it.
      const onwardPath = makePath(onward.map((p): [number, number] => [p.lat, p.lng]))
      for (let d = pickupM; d <= path.length; d += 20) {
        const p = pointAt(path, d)
        const nearest = Math.min(...Array.from({ length: Math.ceil(onwardPath.length / 5) + 1 }, (_, i) => distanceM(p, pointAt(onwardPath, i * 5))))
        expect(nearest, `${name} at ${d} m`).toBeLessThan(5)
      }
      // It stops outside the mock's arrival radius, so the ride is not over until 我已下車 (DD-23, DD-30).
      const end = onward.at(-1)!
      expect(distanceM(path.points.at(-1)!, end)).toBeGreaterThan(ARRIVAL_RADIUS_M)
      expect(distanceM(path.points.at(-1)!, end)).toBeLessThan(150)
      expect(route.holdUntilRequest).toBe(true)
      // Past the pickup area and its leave margin, so it counts as passed (DD-06), but not far past.
      expect(route.fastForward!.untilM).toBeGreaterThan(pickupM + PICKUP_RADIUS_M + PASS_MARGIN_M)
      expect(route.fastForward!.untilM).toBeLessThan(pickupM + 200)
      expect(route.fastToEnd).toBeDefined()
    })

  }

  it('two rides in one page load: each matched car, driven along its tour route, passes the pickup (#217 review)', () => {
    const api = createMockApi(loadStaticData(), Date.now, { followReports: true })
    const call = <T>(method: string, path: string, auth: string, body?: unknown) => {
      const u = new URL(path, 'http://x')
      return api.handle({ method, path: u.pathname, query: u.searchParams, authorization: auth, body }).body as T
    }
    const P = 'Bearer passenger:passenger1'
    const SUBMIT = { pickup_point_id: 1, location: { lat: 25.0498, lng: 121.5782 }, destination: { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }, stop_ids: [9, 23], tag_filters: [] }
    const carried: string[] = []
    for (let ride = 0; ride < 3; ride++) {
      call('POST', '/api/activities', P)
      const { id } = call<{ id: number }>('POST', '/api/passenger/requests', P, SUBMIT)
      const name = TOUR_DRIVERS.find((n) => call<{ pending: { id: number }[] }>('GET', '/api/driver/requests', `Bearer driver:${n}`).pending.some((r) => r.id === id))!
      carried.push(name)
      const auth = `Bearer driver:${name}`
      const trip = call<TripView>('GET', '/api/driver/trips/current', auth)
      call('POST', `/api/driver/requests/${id}/accept`, auth)
      const route = tourRoute(SIMULATOR_ROUTES[name], decodePolyline(trip.route!.polyline))
      const path = makePath(route.path)
      const report = (from: number, to: number) => {
        for (let d = from; d < to; d += 20) call('POST', '/api/location', auth, pointAt(path, d))
        call('POST', '/api/location', auth, pointAt(path, to))
      }
      // Where the first fast-forward leaves the car (T63): the board must say it has passed the pickup.
      report(0, route.fastForward!.untilM)
      const atPickup = call<RequestStatusView>('GET', `/api/passenger/requests/${id}`, P)
      expect(atPickup.passed_pickup, `ride ${ride + 1} on ${name}`).toBe(true)
      expect(atPickup.eta_s).toBeNull()
      call('POST', `/api/passenger/requests/${id}/board`, P)
      // The second fast-forward (T64) to the cut: still the visitor's ride to finish (DD-23).
      report(route.fastForward!.untilM, path.length)
      expect(call<RequestStatusView>('GET', `/api/passenger/requests/${id}`, P).status).toBe('boarded')
      call('POST', `/api/passenger/requests/${id}/complete`, P)
    }
    // The other cars get rides too, so it is not driver1 alone.
    expect(new Set(carried).size).toBeGreaterThan(1)
  })

  it('the showcase routes are untouched', () => {
    for (const name of ['driver1', 'driver2', 'driver3']) {
      expect(SIMULATOR_ROUTES[name].holdUntilRequest).toBeUndefined()
      expect(SIMULATOR_ROUTES[name].fastForward).toBeUndefined()
    }
  })
})
