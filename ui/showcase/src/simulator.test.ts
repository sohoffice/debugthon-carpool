import { distanceM } from '@carpool/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSimulator, SEEDED_TRIP_ACCOUNTS, TICK_MS, type SimulatorStatus } from './simulator'
import source from './simulator.ts?raw'
import { makePath, pointAt, REPORT_STEP_M } from './simulatorPath'
import { SIMULATOR_ROUTES } from './simulatorRoutes'

const SONGSHAN = { lat: 25.049806, lng: 121.578206 }
const PICKUP_RADIUS_M = 80
/** pass_margin (DD-06): passed once beyond the radius plus this. */
const PASS_MARGIN_M = 25
const SPEED_MS = 25 / 3.6

/**
 * Trips for driver1 (1), driver4 (4) and driver5 (5), no requests until the test sets `pending` or
 * `passengers`. driver1 auto-accepts: one request (101) waits until it is accepted.
 */
function fakeBackend() {
  const reports: { account: string; lat: number; lng: number; at: number }[] = []
  const accepts: string[] = []
  const world = {
    trip: { driver1: 1, driver4: 4, driver5: 5 } as Record<string, number>,
    pending: {} as Record<string, number[]>,
    passengers: {} as Record<string, number[]>,
    boarded: new Set<number>(),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const account = String((init.headers as Record<string, string>).Authorization).split(':')[1]
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      if (url === '/api/driver/trips/current') return reply({ id: world.trip[account], auto_accept: account === 'driver1' })
      if (url === '/api/driver/requests') {
        const item = (id: number) => ({ id, boarded: world.boarded.has(id) })
        const pending = account === 'driver1' && !accepts.includes(account) ? [101] : (world.pending[account] ?? [])
        return reply({ trip_id: world.trip[account], pending: pending.map(item), passengers: (world.passengers[account] ?? []).map(item) })
      }
      if (url === '/api/driver/requests/101/accept' && init.method === 'POST') {
        accepts.push(account)
        return reply({ id: 101, status: 'confirmed' })
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
  return { reports, accepts, world, along }
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

/** Metres along a route's path to 松山車站. */
function toPickup(name: string): number {
  const path = makePath(SIMULATOR_ROUTES[name].path)
  return path.cumulative[path.points.findIndex((p) => distanceM(p, SONGSHAN) < 1)]
}

const maxGap = (along: number[]) => Math.max(...along.slice(1).map((d, i) => d - along[i]))
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

/** A started engine with its latest statuses; stopped after each test. */
function started(accounts: string[], fastForward = true) {
  const statuses: Record<string, SimulatorStatus> = {}
  const sim = createSimulator({ accounts, fastForward, confirmFor: SEEDED_TRIP_ACCOUNTS, onStatus: (name, s) => (statuses[name] = s) })
  engines.push(sim)
  sim.start()
  return { sim, statuses }
}
let engines: ReturnType<typeof createSimulator>[] = []

describe('simulator without React (T67, DD-14, DD-46)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    engines.forEach((e) => e.stop())
    engines = []
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('imports no React, so the static site scripts can drive it', () => {
    expect(source).not.toMatch(/from ['"]react/)
    expect(source).not.toMatch(/from ['"]\.\/config/)
  })

  it('advances driver1 at its set speed by elapsed time and confirms its auto-accepting trip (DD-33)', async () => {
    const backend = fakeBackend()
    const { statuses } = started(['driver1'])
    await advance(20 * TICK_MS)

    const along = backend.along('driver1')
    expect(along[0]).toBe(0)
    expect(along.at(-1)).toBeGreaterThan(19 * SPEED_MS)
    expect(along.at(-1)).toBeLessThan(21 * SPEED_MS + REPORT_STEP_M)
    expect(statuses.driver1).toMatchObject({ kind: 'moving' })
    expect(backend.accepts).toEqual(['driver1'])
  })

  it('does not confirm for an account outside confirmFor', async () => {
    const backend = fakeBackend()
    const sim = createSimulator({ accounts: ['driver1'], fastForward: true })
    engines.push(sim)
    sim.start()
    await advance(5 * TICK_MS)
    expect(backend.accepts).toEqual([])
  })

  it('a parked car reports its path start once, and moves only from its release', async () => {
    const backend = fakeBackend()
    const { sim, statuses } = started(['driver4', 'driver5'])
    await advance(30 * TICK_MS)

    // One report at the start, so the static site's mock backend has the car (followReports).
    const [lat, lng] = SIMULATOR_ROUTES.driver5.path[0]
    expect(backend.reports.filter((r) => r.account === 'driver5')).toEqual([expect.objectContaining({ lat: expect.closeTo(lat, 6), lng: expect.closeTo(lng, 6) })])
    expect(statuses.driver5).toEqual({ kind: 'held' })

    // Released from outside (the off-stage decline): 10 s at 25 km/h from then, not from departure.
    sim.release('driver5', 5)
    await advance(10 * TICK_MS)
    expect(backend.along('driver5').at(-1)).toBeGreaterThan(9 * SPEED_MS)
    expect(backend.along('driver5').at(-1)).toBeLessThan(11 * SPEED_MS + REPORT_STEP_M)
    expect(statuses.driver5).toMatchObject({ kind: 'moving' })
    // A release for another trip id does nothing.
    sim.release('driver4', 99)
    await advance(5 * TICK_MS)
    expect(backend.along('driver4')).toEqual([0])
  })

  it('a request releases the car, and it stays released once the request is gone', async () => {
    const backend = fakeBackend()
    started(['driver5'])
    await advance(5 * TICK_MS)
    backend.world.pending.driver5 = [9]
    await advance(TICK_MS)
    backend.world.pending.driver5 = []
    await advance(10 * TICK_MS)
    expect(backend.along('driver5').at(-1)).toBeGreaterThan(9 * SPEED_MS)
  })

  it('driver4 fast-forwards past the pickup after the confirm and to the end after boarding, never more than 20 m apart', async () => {
    const backend = fakeBackend()
    const { statuses } = started(['driver4'])
    await advance(5 * TICK_MS)
    backend.world.passengers.driver4 = [9]
    const confirmedAt = Date.now()
    await advance(4 * TICK_MS)

    // Past the pickup area (DD-06) within about 3 s of the confirm.
    const path = makePath(SIMULATOR_ROUTES.driver4.path)
    const passAt = toPickup('driver4') + PICKUP_RADIUS_M + PASS_MARGIN_M
    const passed = backend.reports.filter((r) => r.account === 'driver4').find((r) => alongPath(path, r) > passAt)
    expect(passed!.at - confirmedAt).toBeLessThanOrEqual(3_000)
    expect(backend.along('driver4').at(-1)).toBeLessThan(path.length / 2)

    backend.world.boarded.add(9)
    const boardedAt = Date.now()
    await advance(7 * TICK_MS)
    const last = backend.reports.filter((r) => r.account === 'driver4').at(-1)!
    const [lat, lng] = SIMULATOR_ROUTES.driver4.path.at(-1)!
    expect(last).toMatchObject({ lat: expect.closeTo(lat, 6), lng: expect.closeTo(lng, 6) })
    expect(last.at - boardedAt).toBeLessThanOrEqual(6_000)
    expect(statuses.driver4).toEqual({ kind: 'arrived' })
    expect(maxGap(backend.along('driver4'))).toBeLessThanOrEqual(REPORT_STEP_M + 1)
  })

  it('with fastForward false the confirm and boarding keep the set speed, and the hold stays', async () => {
    const backend = fakeBackend()
    started(['driver4', 'driver5'], false)
    backend.world.passengers.driver4 = [9]
    await advance(3 * TICK_MS)
    backend.world.boarded.add(9)
    await advance(10 * TICK_MS)

    expect(backend.along('driver4').at(-1)).toBeLessThan(14 * SPEED_MS + REPORT_STEP_M)
    expect(backend.along('driver5')).toEqual([0])
  })

  it('after a minute with no tick, catches up by elapsed time in steps of at most 20 m (DD-06)', async () => {
    const backend = fakeBackend()
    started(['driver5'])
    backend.world.pending.driver5 = [9]
    await advance(TICK_MS)
    vi.setSystemTime(Date.now() + 60_000)
    await advance(TICK_MS)

    const along = backend.along('driver5')
    expect(along.at(-1)).toBeGreaterThan(60 * SPEED_MS - REPORT_STEP_M)
    expect(maxGap(along)).toBeLessThanOrEqual(REPORT_STEP_M + 1)
    // Passes through the pickup area, not over it.
    const path = makePath(SIMULATOR_ROUTES.driver5.path)
    expect(along.some((d) => distanceM(pointAt(path, d), SONGSHAN) <= PICKUP_RADIUS_M)).toBe(true)
  })

  it('a tick called by hand while the timer runs sends no report twice', async () => {
    const backend = fakeBackend()
    const { sim } = started(['driver1'])
    await Promise.all([sim.tick(), sim.tick(), advance(10 * TICK_MS), sim.tick()])

    const along = backend.along('driver1')
    expect(new Set(along).size).toBe(along.length)
    expect(along).toEqual([...along].sort((a, b) => a - b))
  })

  it('stop() ends the reports and the statuses', async () => {
    const backend = fakeBackend()
    const { sim, statuses } = started(['driver1'])
    await advance(5 * TICK_MS)
    sim.stop()
    const count = backend.reports.length
    const status = statuses.driver1
    await advance(10 * TICK_MS)
    await sim.tick()

    expect(backend.reports).toHaveLength(count)
    expect(statuses.driver1).toBe(status)
  })
})
