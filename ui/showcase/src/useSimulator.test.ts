import { distanceM } from '@carpool/shared'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePath, pointAt, REPORT_STEP_M } from './simulatorPath'
import { SIMULATOR_ROUTES } from './simulatorRoutes'
import { SEEDED_TRIP_ACCOUNTS, SIMULATED_ACCOUNTS, TRIP_CHECK_MS, useSimulator } from './useSimulator'

const TICK_MS = 1000
const SONGSHAN = { lat: 25.049806, lng: 121.578206 }
const PICKUP_RADIUS_M = 80
/** pass_margin (DD-06): passed once beyond the radius plus this. */
const PASS_MARGIN_M = 25

/**
 * A backend for five drivers. Every account but `late` has a running trip from the start; `late`
 * answers 404 until `departLate()`, like a person departing from the driver UI later. Each trip in
 * `autoAccept` auto-accepts; every account has one request waiting (id 100 + its index) until it
 * is accepted. `answered`'s request was answered elsewhere just after the poll: accepting it is
 * 409 not_waiting, and later polls no longer list it.
 */
function fakeBackend(late: string | null, { autoAccept = [] as string[], answered = null as string | null } = {}) {
  const reports: { account: string; lat: number; lng: number }[] = []
  const accepts: string[] = []
  const refused: string[] = []
  let lateDeparted = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const account = String((init.headers as Record<string, string>).Authorization).split(':')[1]
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      if (url === '/api/driver/trips/current') {
        if (account === late && !lateDeparted) return reply({ error: { code: 'not_found', message: '目前沒有進行中的行程' } }, 404)
        return reply({ id: SIMULATED_ACCOUNTS.indexOf(account) + 1, auto_accept: autoAccept.includes(account) })
      }
      const requestId = 100 + SIMULATED_ACCOUNTS.indexOf(account)
      if (url === '/api/driver/requests') {
        const pending = accepts.includes(account) || refused.includes(account) ? [] : [{ id: requestId, status: 'waiting_driver' }]
        return reply({ trip_id: SIMULATED_ACCOUNTS.indexOf(account) + 1, pending, passengers: [] })
      }
      if (url === `/api/driver/requests/${requestId}/accept` && init.method === 'POST') {
        if (account === answered) {
          refused.push(account)
          return reply({ error: { code: 'not_waiting', message: '請求已不在等待駕駛回應' } }, 409)
        }
        accepts.push(account)
        return reply({ id: requestId, status: 'confirmed' })
      }
      if (url === '/api/location' && init.method === 'POST') {
        reports.push({ account, ...JSON.parse(String(init.body)) })
        return reply({}, 201)
      }
      return reply({ error: { code: 'not_found', message: '' } }, 404)
    }),
  )
  return { reports, accepts, refused, departLate: () => (lateDeparted = true) }
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('simulator (T08, DD-14)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reports for every account with a trip, none for one without, and starts once a trip appears', async () => {
    const late = 'driver5'
    const backend = fakeBackend(late)
    const { result } = renderHook(() => useSimulator(SIMULATED_ACCOUNTS, true))
    await advance(3 * TICK_MS)

    // Five accounts are simulated at once; each with a running trip reports its position.
    expect(SIMULATED_ACCOUNTS).toHaveLength(5)
    for (const account of SIMULATED_ACCOUNTS.filter((a) => a !== late)) {
      expect(backend.reports.some((r) => r.account === account)).toBe(true)
    }
    // No running trip, no report.
    expect(backend.reports.filter((r) => r.account === late)).toEqual([])
    expect(result.current.statuses[late]).toEqual({ kind: 'no_trip' })

    // The driver departs from the UI: within a second the simulator picks the trip up (DD-45),
    // starting from the beginning of the account's path.
    expect(TRIP_CHECK_MS).toBe(1000)
    backend.departLate()
    await advance(TICK_MS)
    const lateReports = backend.reports.filter((r) => r.account === late)
    expect(lateReports.length).toBeGreaterThan(0)
    const [lat, lng] = SIMULATOR_ROUTES[late].path[0]
    expect(lateReports[0]).toMatchObject({ lat: expect.closeTo(lat, 6), lng: expect.closeTo(lng, 6) })
    expect(result.current.statuses[late]).toMatchObject({ kind: 'moving' })
  })
  it('confirms for the seeded trips that auto-accept, never for driver4 or driver5 (DD-14, DD-33)', async () => {
    // Every trip here auto-accepts except driver3's; driver4 and driver5 are left to the driver UI.
    const backend = fakeBackend(null, { autoAccept: SIMULATED_ACCOUNTS.filter((a) => a !== 'driver3') })
    renderHook(() => useSimulator(SIMULATED_ACCOUNTS, true))
    await advance(3 * TICK_MS)

    expect(SEEDED_TRIP_ACCOUNTS).toEqual(['driver1', 'driver2', 'driver3'])
    expect(backend.accepts.sort()).toEqual(['driver1', 'driver2'])
    // Each request is confirmed once, not again on later polls.
    await advance(TRIP_CHECK_MS)
    expect(backend.accepts.sort()).toEqual(['driver1', 'driver2'])
  })

  it('a request answered in the meantime (409 not_waiting) is not an error (DD-33)', async () => {
    const backend = fakeBackend(null, { autoAccept: ['driver1'], answered: 'driver1' })
    const { result } = renderHook(() => useSimulator(['driver1'], true))
    // Tick by tick, so an error shown for a moment is seen too.
    const seen: string[] = []
    for (const ms of [0, TICK_MS, TICK_MS]) {
      await advance(ms)
      seen.push(result.current.statuses.driver1?.kind ?? 'none')
    }

    expect(backend.refused).toEqual(['driver1'])
    expect(backend.accepts).toEqual([])
    expect(seen).toEqual(['moving', 'moving', 'moving'])
  })
})

/** Metres along a route's path to 松山車站. */
function toPickup(name: string): number {
  const path = makePath(SIMULATOR_ROUTES[name].path)
  return path.cumulative[path.points.findIndex((p) => distanceM(p, SONGSHAN) < 1)]
}

/**
 * The two stage drivers with running trips (driver4 trip 4, driver5 trip 5) and no requests until
 * the test sets `pending` or `passengers` for an account; `trip` changes an account's trip id.
 */
function fakeStageBackend() {
  const reports: { account: string; lat: number; lng: number; at: number }[] = []
  const world = {
    trip: { driver4: 4, driver5: 5 } as Record<string, number>,
    pending: {} as Record<string, number[]>,
    passengers: {} as Record<string, number[]>,
    /** Passengers on board, by request id. */
    boarded: new Set<number>(),
    /** Runs while a trip lookup is out, before it answers. */
    duringTripCheck: null as ((account: string) => void) | null,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const account = String((init.headers as Record<string, string>).Authorization).split(':')[1]
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      if (url === '/api/driver/trips/current') {
        world.duringTripCheck?.(account)
        return reply({ id: world.trip[account], auto_accept: false })
      }
      if (url === '/api/driver/requests') {
        const item = (id: number) => ({ id, boarded: world.boarded.has(id) })
        return reply({ trip_id: world.trip[account], pending: (world.pending[account] ?? []).map(item), passengers: (world.passengers[account] ?? []).map(item) })
      }
      if (url === '/api/location' && init.method === 'POST') {
        reports.push({ account, ...JSON.parse(String(init.body)), at: Date.now() })
        return reply({}, 201)
      }
      return reply({ error: { code: 'not_found', message: '' } }, 404)
    }),
  )
  const along = (account: string) => {
    const path = makePath(SIMULATOR_ROUTES[account].path)
    return reports.filter((r) => r.account === account).map((r) => alongPath(path, r))
  }
  return { reports, world, along }
}

/** Metres along the path of the nearest point on it, for a reported position. */
function alongPath(path: ReturnType<typeof makePath>, p: { lat: number; lng: number }): number {
  let best = { d: Infinity, at: 0 }
  for (let at = 0; at <= path.length; at += 1) {
    const d = distanceM(pointAt(path, at), p)
    if (d < best.d) best = { d, at }
  }
  return best.at
}

const STAGE = ['driver4', 'driver5']

describe('stage drivers hold, then fast-forward (T63, DD-14, DD-45)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('parks driver4 and driver5 at their path starts with one report each until a request comes', async () => {
    const backend = fakeStageBackend()
    const { result } = renderHook(() => useSimulator(STAGE, true))
    // Three minutes with no request.
    await advance(180 * TICK_MS)

    for (const account of STAGE) {
      const own = backend.reports.filter((r) => r.account === account)
      const [lat, lng] = SIMULATOR_ROUTES[account].path[0]
      expect(own, account).toHaveLength(1)
      expect(own[0]).toMatchObject({ lat: expect.closeTo(lat, 6), lng: expect.closeTo(lng, 6) })
      expect(result.current.statuses[account]).toEqual({ kind: 'held' })
    }
  })

  it('a request releases the car at its set speed, and it stays released once the request is gone', async () => {
    const backend = fakeStageBackend()
    renderHook(() => useSimulator(STAGE, true))
    await advance(30 * TICK_MS)
    backend.world.pending.driver5 = [9]
    await advance(TICK_MS)
    // Declined and reassigned: driver5 has no request any more, but keeps driving.
    backend.world.pending.driver5 = []
    await advance(20 * TICK_MS)

    const along = backend.along('driver5')
    // About 21 s at 25 km/h since the release, not since departure.
    expect(along.at(-1)).toBeGreaterThan(20 * (25 / 3.6))
    expect(along.at(-1)).toBeLessThan(22 * (25 / 3.6) + REPORT_STEP_M)
    // driver4 had no request: still parked.
    expect(backend.along('driver4')).toEqual([0])
  })

  it('release() moves driver5 even when the simulator never saw its request (declined off stage first)', async () => {
    const backend = fakeStageBackend()
    const { result } = renderHook(() => useSimulator(STAGE, true))
    await advance(5 * TICK_MS)
    act(() => result.current.release('driver5', 5))
    await advance(10 * TICK_MS)

    expect(backend.along('driver5').at(-1)).toBeGreaterThan(9 * (25 / 3.6))
    expect(result.current.statuses.driver5).toMatchObject({ kind: 'moving' })
    // A release for another trip id does nothing.
    act(() => result.current.release('driver4', 99))
    await advance(5 * TICK_MS)
    expect(backend.along('driver4')).toEqual([0])
  })

  it('a release() that lands while the trip lookup is out is not lost (the off-stage decline races the simulator)', async () => {
    const backend = fakeStageBackend()
    const { result } = renderHook(() => useSimulator(STAGE, true))
    await advance(3 * TICK_MS)
    // The off-stage round declines driver5's request while the simulator is reading driver5's trip.
    backend.world.duringTripCheck = (account) => {
      if (account !== 'driver5') return
      backend.world.duringTripCheck = null
      result.current.release('driver5', 5)
    }
    await advance(10 * TICK_MS)

    expect(backend.along('driver5').at(-1)).toBeGreaterThan(8 * (25 / 3.6))
    expect(result.current.statuses.driver5).toMatchObject({ kind: 'moving' })
  })

  it('driver4 passes the pickup within about 3 s of its passenger being confirmed, reports at most 20 m apart, then drives at 25 km/h', async () => {
    const backend = fakeStageBackend()
    renderHook(() => useSimulator(STAGE, true))
    await advance(60 * TICK_MS)
    backend.world.pending.driver4 = [9]
    await advance(4 * TICK_MS)
    backend.world.pending.driver4 = []
    backend.world.passengers.driver4 = [9]
    const confirmedAt = Date.now()
    await advance(4 * TICK_MS)

    const passAt = toPickup('driver4') + PICKUP_RADIUS_M + PASS_MARGIN_M
    const reports = backend.reports.filter((r) => r.account === 'driver4')
    const path = makePath(SIMULATOR_ROUTES.driver4.path)
    const passed = reports.find((r) => alongPath(path, r) > passAt)
    expect(passed).toBeDefined()
    // Up to a tick to see the confirm, one tick to drive: the passenger UI's own poll adds up to 1 s (about 4 s in all).
    expect(passed!.at - confirmedAt).toBeLessThanOrEqual(3_000)
    const along = backend.along('driver4')
    const gaps = along.slice(1).map((d, i) => d - along[i])
    expect(Math.max(...gaps)).toBeLessThanOrEqual(REPORT_STEP_M + 1)

    // Back to 25 km/h: 10 more seconds is about 70 m.
    const before = along.at(-1)!
    await advance(10 * TICK_MS)
    const after = backend.along('driver4').at(-1)!
    expect(after - before).toBeGreaterThan(9 * (25 / 3.6))
    expect(after - before).toBeLessThan(11 * (25 / 3.6) + REPORT_STEP_M)
  })

  it('once its passenger is on board, driver4 fast-forwards to the path end in 20 m steps, in about 4-5 s (T64)', async () => {
    const backend = fakeStageBackend()
    const { result } = renderHook(() => useSimulator(STAGE, true))
    await advance(5 * TICK_MS)
    backend.world.passengers.driver4 = [9]
    await advance(10 * TICK_MS)
    const path = makePath(SIMULATOR_ROUTES.driver4.path)
    expect(backend.along('driver4').at(-1)).toBeLessThan(path.length / 2)

    backend.world.boarded.add(9)
    const boardedAt = Date.now()
    await advance(7 * TICK_MS)

    const reports = backend.reports.filter((r) => r.account === 'driver4')
    const last = reports.at(-1)!
    const [lat, lng] = SIMULATOR_ROUTES.driver4.path.at(-1)!
    expect(last).toMatchObject({ lat: expect.closeTo(lat, 6), lng: expect.closeTo(lng, 6) })
    // Up to a tick to see the boarding, then about 4 s of driving.
    expect(last.at - boardedAt).toBeGreaterThan(3_500)
    expect(last.at - boardedAt).toBeLessThanOrEqual(6_000)
    const along = backend.along('driver4')
    const gaps = along.slice(1).map((d, i) => d - along[i])
    expect(Math.max(...gaps)).toBeLessThanOrEqual(REPORT_STEP_M + 1)
    expect(result.current.statuses.driver4).toEqual({ kind: 'arrived' })
  })

  it('a ride completed without boarding also sends driver4 on to the end (T64)', async () => {
    const backend = fakeStageBackend()
    renderHook(() => useSimulator(STAGE, true))
    backend.world.passengers.driver4 = [9]
    await advance(10 * TICK_MS)
    // 我已下車 straight from the confirmed screen: the passenger list empties, nobody was marked boarded.
    backend.world.passengers.driver4 = []
    await advance(5 * TICK_MS)

    const path = makePath(SIMULATOR_ROUTES.driver4.path)
    expect(backend.along('driver4').at(-1)).toBeGreaterThan(path.length - 1)
  })

  it('?fast=0 keeps driver4 at its set speed, after the confirm and after boarding (T64)', async () => {
    const backend = fakeStageBackend()
    renderHook(() => useSimulator(STAGE, true, false))
    backend.world.passengers.driver4 = [9]
    await advance(3 * TICK_MS)
    backend.world.boarded.add(9)
    await advance(10 * TICK_MS)

    // 13 s at 25 km/h from the release, and still parked until the request: the hold stays.
    expect(backend.along('driver4').at(-1)).toBeLessThan(14 * (25 / 3.6) + REPORT_STEP_M)
    const parked = fakeStageBackend()
    renderHook(() => useSimulator(STAGE, true, false))
    await advance(30 * TICK_MS)
    expect(parked.along('driver5')).toEqual([0])
  })

  it('a background tab that skipped ticks while parked catches up by elapsed time from the release, in 20 m steps', async () => {
    const backend = fakeStageBackend()
    renderHook(() => useSimulator(STAGE, true))
    backend.world.pending.driver5 = [9]
    await advance(TICK_MS)
    const releasedAt = Date.now()
    // The browser runs no timer for a minute, then one tick.
    vi.setSystemTime(releasedAt + 60_000)
    await advance(TICK_MS)

    const along = backend.along('driver5')
    expect(along.at(-1)).toBeGreaterThan(60 * (25 / 3.6) - REPORT_STEP_M)
    expect(along.at(-1)).toBeLessThan(62 * (25 / 3.6) + REPORT_STEP_M)
    const gaps = along.slice(1).map((d, i) => d - along[i])
    expect(Math.max(...gaps)).toBeLessThanOrEqual(REPORT_STEP_M + 1)
  })

  it('a new trip (Demo reset, 重新開始) parks the car at its path start again', async () => {
    const backend = fakeStageBackend()
    const { result } = renderHook(() => useSimulator(STAGE, true))
    backend.world.pending.driver5 = [9]
    await advance(20 * TICK_MS)
    expect(backend.along('driver5').at(-1)).toBeGreaterThan(100)

    backend.world.pending.driver5 = []
    backend.world.trip.driver5 = 55
    await advance(20 * TICK_MS)
    expect(backend.along('driver5').at(-1)).toBe(0)
    expect(result.current.statuses.driver5).toEqual({ kind: 'held' })
  })
})
