// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { distanceM } from '@carpool/shared'
import { makePath } from '../showcase/src/simulatorPath.ts'
import { SIMULATOR_ROUTES } from '../showcase/src/simulatorRoutes.ts'
import {
  CONFIRM_DELAY_MS,
  detectPassengerStep,
  dueToConfirm,
  PASSENGER_STEPS,
  TOUR_ROUTES,
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

  for (const name of ['driver1', 'driver2', 'driver3']) {
    it(`${name}: the showcase path cut short of its end, parked until a request, fast past the pickup, then fast to the cut`, () => {
      const route = TOUR_ROUTES[name]
      const full = makePath(SIMULATOR_ROUTES[name].path)
      const cut = makePath(route.path)
      const end = full.points.at(-1)!
      const pickupIndex = full.points.findIndex((p) => p.lat === 25.049806 && p.lng === 121.578206)
      const pickupM = full.cumulative[pickupIndex]

      // Same streets as the showcase up to the cut.
      expect(route.path.slice(0, -1)).toEqual(SIMULATOR_ROUTES[name].path.slice(0, route.path.length - 1))
      // The car stops outside the mock's arrival radius, so the ride is not over until 我已下車 (DD-23, DD-30).
      expect(distanceM(cut.points.at(-1)!, end)).toBeGreaterThan(ARRIVAL_RADIUS_M)
      expect(distanceM(cut.points.at(-1)!, end)).toBeLessThan(150)
      expect(route.holdUntilRequest).toBe(true)
      // Past the pickup area and its leave margin, so it counts as passed (DD-06), but not far past.
      expect(route.fastForward!.untilM).toBeGreaterThan(pickupM + PICKUP_RADIUS_M + PASS_MARGIN_M)
      expect(route.fastForward!.untilM).toBeLessThan(pickupM + 200)
      expect(route.fastToEnd).toBeDefined()
    })
  }

  it('the showcase routes are untouched', () => {
    for (const name of ['driver1', 'driver2', 'driver3']) {
      expect(SIMULATOR_ROUTES[name].holdUntilRequest).toBeUndefined()
      expect(SIMULATOR_ROUTES[name].fastForward).toBeUndefined()
    }
  })
})
