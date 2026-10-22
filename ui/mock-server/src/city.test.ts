// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { CityHistory, CityLive, CityToday, CityTraffic } from '../../shared/src/api/types.ts'
import { createMockApi } from './api.ts'
import { commuteToday, pastWorkdays } from './city.ts'
import { loadStaticData } from './data/load.ts'

const data = loadStaticData()
const CITY = 'Bearer city:city1'
let api: ReturnType<typeof createMockApi>
let clock = 0

function call(path: string, authorization = CITY) {
  const [pathname, qs] = path.split('?')
  return api.handle({ method: 'GET', path: pathname, query: new URLSearchParams(qs), authorization, body: undefined })
}
const get = <T,>(path: string) => call(path).body as T
const advance = (seconds: number) => api.handle({ method: 'POST', path: '/api/_mock/advance', query: new URLSearchParams(), authorization: undefined, body: { seconds } })

beforeEach(() => {
  // Saturday 10/24 in the afternoon: the dashboard's today is Monday 10/26 at 08:15 (DD-41).
  clock = Date.parse('2026-10-24T15:00:00+08:00')
  api = createMockApi(data, () => clock)
})

describe('mock /api/city/* (DD-39, DD-40, DD-41)', () => {
  it('moves a weekend to the next Monday and counts 10 workdays back from it', () => {
    expect(commuteToday(clock)).toBe('2026-10-26')
    const days = pastWorkdays('2026-10-26')
    expect(days[0]).toBe('2026-10-23')
    expect(days[9]).toBe('2026-10-12')
  })

  it('lets only a city token in, and keeps a city token out of the other APIs', () => {
    expect(call('/api/city/live', 'Bearer driver:driver1').status).toBe(403)
    expect(call('/api/city/live', 'Bearer city:driver1').status).toBe(403)
    expect(call('/api/city/live', 'Bearer city:nobody').status).toBe(401)
    expect(call('/api/pickup-points').status).toBe(403)
    expect(call('/api/me').status).toBe(403)
    expect(call('/api/city/live').status).toBe(200)
  })

  it('reports the Demo clock on every response', () => {
    for (const path of ['/api/city/live', '/api/city/traffic', '/api/city/today', '/api/city/history']) {
      expect(get<CityLive>(path)).toMatchObject({ now: '2026-10-26T08:15:00+08:00', today: '2026-10-26', demo_clock: true })
    }
  })

  it('shows one round of 30-40 simulated cars that arrive, add to today and do not come back', () => {
    const first = get<CityLive>('/api/city/live')
    const startCars = first.vehicles.filter((v) => v.simulated).length
    expect(startCars).toBeGreaterThan(10)
    expect(first.simulated).toBe(true)
    const before = get<CityToday>('/api/city/today').completed

    advance(3600)
    const later = get<CityLive>('/api/city/live')
    expect(later.vehicles.filter((v) => v.simulated)).toHaveLength(0)
    const after = get<CityToday>('/api/city/today')
    expect(after.completed - before).toBeGreaterThanOrEqual(30)
    expect(after.match_rate).toBeLessThanOrEqual(1)
  })

  it('a reset starts a new round', () => {
    get<CityLive>('/api/city/live')
    advance(3600)
    expect(get<CityLive>('/api/city/live').vehicles.filter((v) => v.simulated)).toHaveLength(0)
    api.handle({ method: 'POST', path: '/api/demo/reset', query: new URLSearchParams(), authorization: undefined, body: undefined })
    expect(get<CityLive>('/api/city/live').vehicles.filter((v) => v.simulated).length).toBeGreaterThan(10)
  })

  it('defaults traffic to the latest slot, 08:00 today, and answers a past slot', () => {
    const latest = get<CityTraffic>('/api/city/traffic')
    expect(latest.slot_start).toBe('2026-10-26T08:00:00+08:00')
    expect(latest.detectors.length).toBeGreaterThan(9)
    const past = get<CityTraffic>(`/api/city/traffic?slot=${encodeURIComponent('2026-10-20T09:30:00+08:00')}`)
    expect(past.slot_start).toBe('2026-10-20T09:30:00+08:00')
    expect(call(`/api/city/traffic?slot=${encodeURIComponent('2026-10-26T08:15:00+08:00')}`).status).toBe(404)
    expect(call(`/api/city/traffic?slot=${encodeURIComponent('2026-10-20T09:31:00+08:00')}`).status).toBe(400)
  })

  it('history: ten days newest first, each with weather, and per-day pickup averages', () => {
    const h = get<CityHistory>('/api/city/history')
    expect(h.days.map((d) => d.date)).toEqual(pastWorkdays('2026-10-26'))
    expect(h.days.every((d) => d.weather !== null && d.rides > 0)).toBe(true)
    expect(h.pickup_points).toHaveLength(3)
    for (const p of h.pickup_points) expect(p.rides_per_day).toBeLessThanOrEqual(p.passengers_per_day)
  })

  it('keeps names, accounts and plates out of every response (REQ-081)', () => {
    get<CityLive>('/api/city/live')
    const text = ['/api/city/live', '/api/city/traffic', '/api/city/today', '/api/city/history'].map((p) => JSON.stringify(get(p))).join()
    for (const key of ['username', 'display_name', 'plate', 'driver_id', 'passenger_id', 'trip_id']) expect(text).not.toContain(`"${key}"`)
  })
})
