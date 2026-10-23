// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { CityHistory, CityLive, CityToday, CityTraffic, CityTrafficDay, CommuteTraffic, PickupRides } from '../../shared/src/api/types.ts'
import { createMockApi } from './api.ts'
import { commuteMoment, pastWorkdays } from './commute.ts'
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
    expect(commuteMoment(clock).today).toBe('2026-10-26')
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
    // The 16 gateways of docs/data/tdx-vd/detectors.csv (DD-36), 6 with a shape, 2 proxies.
    expect(latest.detectors).toHaveLength(16)
    expect(latest.detectors.filter((g) => g.shape !== null)).toHaveLength(6)
    expect(latest.detectors.filter((g) => g.proxy).map((g) => g.gateway)).toEqual(['成美橋', '成功橋'])
    expect(latest).toMatchObject({ simulated: true, weather_simulated: true })
    const past = get<CityTraffic>(`/api/city/traffic?slot=${encodeURIComponent('2026-10-20T09:30:00+08:00')}`)
    expect(past.slot_start).toBe('2026-10-20T09:30:00+08:00')
    expect(call(`/api/city/traffic?slot=${encodeURIComponent('2026-10-26T08:15:00+08:00')}`).status).toBe(404)
    expect(call(`/api/city/traffic?slot=${encodeURIComponent('2026-10-20T09:31:00+08:00')}`).status).toBe(400)
  })

  it('traffic by date: 12 slots of 16 gateways, today through the latest slot; bad and unknown dates refused', () => {
    const day = get<CityTrafficDay>('/api/city/traffic?date=2026-10-22')
    expect(day.slots).toHaveLength(12)
    expect(day.slots.every((s) => s.detectors.length === 16)).toBe(true)
    // The day's 08:30 is the same as asking for that slot.
    expect(day.slots[6]).toEqual((({ now, today, demo_clock, ...slot }) => slot)(get<CityTraffic>(`/api/city/traffic?slot=${encodeURIComponent('2026-10-22T08:30:00+08:00')}`)))
    expect(get<CityTrafficDay>('/api/city/traffic?date=2026-10-26').slots.map((s) => s.slot_start.slice(11, 16))).toEqual(['07:00', '07:15', '07:30', '07:45', '08:00'])
    expect(call('/api/city/traffic?date=2026/10/22').status).toBe(400)
    expect(call('/api/city/traffic?date=2026-10-32').status).toBe(400)
    expect(call(`/api/city/traffic?date=2026-10-22&slot=${encodeURIComponent('2026-10-22T08:00:00+08:00')}`).status).toBe(400)
    expect(call('/api/city/traffic?date=2026-10-24').status).toBe(404)
    expect(call('/api/city/traffic?date=2026-10-09').status).toBe(404)
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

  it('history agrees with the commute info: the same weather per day, rides = the pickup points\' rides (REQ-083)', () => {
    const h = get<CityHistory>('/api/city/history')
    const passenger = (path: string) => call(path, 'Bearer passenger:passenger1').body
    const traffic = passenger('/api/commute/traffic') as CommuteTraffic
    const rides = h.pickup_points.map((p) => passenger(`/api/commute/pickup-rides?pickup_point_id=${p.id}&from=07:00&to=10:00`) as PickupRides)
    for (const day of h.days) {
      const slots = traffic.days.find((d) => d.date === day.date)!.slots
      const rainiest = slots.map((s) => s.weather!).reduce((a, b) => (b.precipitation > a.precipitation ? b : a))
      expect(day.weather).toEqual(rainiest)
      const sum = rides.reduce((n, r) => n + r.days.find((d) => d.date === day.date)!.slots.reduce((m, s) => m + s.ride_count, 0), 0)
      expect(day.rides).toBe(sum)
    }
  })
})
