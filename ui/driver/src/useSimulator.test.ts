import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIMULATOR_ROUTES } from './simulatorRoutes'
import { SEEDED_TRIP_ACCOUNTS, SIMULATED_ACCOUNTS, useSimulator } from './useSimulator'

const TICK_MS = 1000
const TRIP_CHECK_MS = 5000

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
    expect(result.current[late]).toEqual({ kind: 'no_trip' })

    // The driver departs from the UI: within one trip check the simulator picks the trip up,
    // starting from the beginning of the account's path.
    backend.departLate()
    await advance(TRIP_CHECK_MS + TICK_MS)
    const lateReports = backend.reports.filter((r) => r.account === late)
    expect(lateReports.length).toBeGreaterThan(0)
    const [lat, lng] = SIMULATOR_ROUTES[late].path[0]
    expect(lateReports[0]).toMatchObject({ lat: expect.closeTo(lat, 6), lng: expect.closeTo(lng, 6) })
    expect(result.current[late]).toMatchObject({ kind: 'moving' })
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
      seen.push(result.current.driver1?.kind ?? 'none')
    }

    expect(backend.refused).toEqual(['driver1'])
    expect(backend.accepts).toEqual([])
    expect(seen).toEqual(['moving', 'moving', 'moving'])
  })
})
