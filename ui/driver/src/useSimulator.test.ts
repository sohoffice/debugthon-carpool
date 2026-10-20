import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIMULATOR_ROUTES } from './simulatorRoutes'
import { SIMULATED_ACCOUNTS, useSimulator } from './useSimulator'

const TICK_MS = 1000
const TRIP_CHECK_MS = 5000

/**
 * A backend for five drivers. Every account but `late` has a running trip from the start; `late`
 * answers 404 until `departLate()`, like a person departing from the driver UI later.
 */
function fakeBackend(late: string) {
  const reports: { account: string; lat: number; lng: number }[] = []
  let lateDeparted = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const account = String((init.headers as Record<string, string>).Authorization).split(':')[1]
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      if (url === '/api/driver/trips/current') {
        if (account === late && !lateDeparted) return reply({ error: { code: 'not_found', message: '目前沒有進行中的行程' } }, 404)
        return reply({ id: SIMULATED_ACCOUNTS.indexOf(account) + 1 })
      }
      if (url === '/api/location' && init.method === 'POST') {
        reports.push({ account, ...JSON.parse(String(init.body)) })
        return reply({}, 201)
      }
      return reply({ error: { code: 'not_found', message: '' } }, 404)
    }),
  )
  return { reports, departLate: () => (lateDeparted = true) }
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
})
