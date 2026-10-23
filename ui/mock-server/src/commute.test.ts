// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { CommuteTraffic, CommuteWeather, PickupRides } from '../../shared/src/api/types.ts'
import { createMockApi } from './api.ts'
import { loadStaticData } from './data/load.ts'

const data = loadStaticData()
const PASSENGER = 'Bearer passenger:passenger1'
const DRIVER = 'Bearer driver:driver4'
let clock = 0
let api: ReturnType<typeof createMockApi>

function call(path: string, authorization: string | null = PASSENGER) {
  const [pathname, qs] = path.split('?')
  return api.handle({ method: 'GET', path: pathname, query: new URLSearchParams(qs), authorization: authorization ?? undefined, body: undefined })
}
const json = <T,>(path: string, authorization?: string) => call(path, authorization).body as T
const rides = (q = 'pickup_point_id=1&from=07:45&to=08:45', auth?: string) => json<PickupRides>(`/api/commute/pickup-rides?${q}`, auth)

beforeEach(() => {
  // Saturday 10/24, the Demo day: today is Monday 10/26 at the Demo clock (DD-41).
  clock = Date.parse('2026-10-24T14:30:00+08:00')
  api = createMockApi(data, () => clock)
})

describe('commute endpoints match the Go backend (T36, T37)', () => {
  it('weather: now is today at 08:15, Saturday moved to Monday, the latest observation before now', () => {
    const w = json<CommuteWeather>('/api/commute/weather')
    expect(w).toMatchObject({ now: '2026-10-26T08:15:00+08:00', today: '2026-10-26', weather_simulated: true })
    expect(w.weather).toMatchObject({ station_id: 'C0A9F0', station_name: '內湖', obs_time: '2026-10-26T08:10:00+08:00' })
    expect(Object.keys(w.weather!).sort()).toEqual(['air_temperature', 'obs_time', 'precipitation', 'station_id', 'station_name', 'weather'])
  })

  it('traffic: the 10 workdays 10/12-10/23 newest first, 12 slots 07:00-09:45 each', () => {
    const t = json<CommuteTraffic>('/api/commute/traffic', DRIVER)
    expect(t.days.map((d) => d.date)).toEqual(['2026-10-23', '2026-10-22', '2026-10-21', '2026-10-20', '2026-10-19', '2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12'])
    expect(t.days.map((d) => d.weekday)).toEqual([5, 4, 3, 2, 1, 5, 4, 3, 2, 1])
    expect(t.days[0].slots.map((s) => s.slot_start.slice(11, 16))).toEqual(['07:00', '07:15', '07:30', '07:45', '08:00', '08:15', '08:30', '08:45', '09:00', '09:15', '09:30', '09:45'])
    expect(Object.keys(t.days[0].slots[0]).sort()).toEqual(['avg_speed_kmh', 'simulated', 'slot_start', 'volume', 'weather', 'weather_simulated'])
    expect(t).toMatchObject({ simulated: true, weather_simulated: true })
    // Two or three days rain (DD-40 step 1).
    const rainy = t.days.filter((d) => d.slots.some((s) => s.weather.precipitation > 0)).length
    expect(rainy).toBeGreaterThanOrEqual(2)
    expect(rainy).toBeLessThanOrEqual(3)
  })

  it('pickup rides: same days and the same weather per slot as traffic (REQ-083)', () => {
    const t = json<CommuteTraffic>('/api/commute/traffic')
    const r = rides()
    expect(r.days.map((d) => d.date)).toEqual(t.days.map((d) => d.date))
    r.days.forEach((d, i) => expect(d.slots.map((s) => s.weather)).toEqual(t.days[i].slots.map((s) => s.weather)))
  })

  it('pickup rides: today runs 07:00-08:15, the 08:15 slot unobserved, with today’s real rides in it', () => {
    const r = rides()
    expect(r.today.date).toBe('2026-10-26')
    expect(r.today.slots.map((s) => s.slot_start.slice(11, 16))).toEqual(['07:00', '07:15', '07:30', '07:45', '08:00', '08:15'])
    expect(r.today.slots.at(-1)).toMatchObject({ ride_count: 0, weather: null, simulated: false })
  })

  it('pickup rides: the summary averages the window over the 10 days and over Mondays (REQ-056)', () => {
    const r = rides()
    const inWindow = (d: PickupRides['days'][number]) => d.slots.slice(3, 7).reduce((n, s) => n + s.ride_count, 0)
    const totals = r.days.map(inWindow)
    expect(r.summary).toEqual({
      from: '07:45',
      to: '08:45',
      daily_avg: totals.reduce((a, b) => a + b, 0) / 10,
      weekday: 1,
      same_weekday_avg: (totals[4] + totals[9]) / 2,
    })
  })

  it('is the same data on every call of the day, and other pickup points differ', () => {
    expect(rides()).toEqual(rides())
    expect(rides('pickup_point_id=2&from=07:45&to=08:45').days).not.toEqual(rides().days)
  })

  it('refuses a bad pickup point or window like the backend', () => {
    const code = (q: string) => [call(`/api/commute/pickup-rides?${q}`).status, (call(`/api/commute/pickup-rides?${q}`).body as { error: { code: string } }).error.code]
    expect(code('from=07:45&to=08:45')).toEqual([400, 'invalid_request'])
    expect(code('pickup_point_id=x&from=07:45&to=08:45')).toEqual([400, 'invalid_request'])
    expect(code('pickup_point_id=1&from=07:50&to=08:45')).toEqual([400, 'invalid_request'])
    expect(code('pickup_point_id=1&from=06:45&to=08:45')).toEqual([400, 'invalid_request'])
    expect(code('pickup_point_id=1&from=08:45&to=08:45')).toEqual([400, 'invalid_request'])
    expect(code('pickup_point_id=1&from=09:45&to=10:15')).toEqual([400, 'invalid_request'])
    expect(code('pickup_point_id=99&from=07:45&to=08:45')).toEqual([404, 'not_found'])
    expect(call('/api/commute/pickup-rides?pickup_point_id=1&from=09:45&to=10:00').status).toBe(200)
    expect(call('/api/commute/weather', null).status).toBe(401)
  })
})
