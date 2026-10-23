import type { CityGateway, CityHistory, CityLive, CityToday, CityTraffic } from '@carpool/shared'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { LIVE_POLL_MS } from './config'

const CLOCK = { now: '2026-10-26T08:15:00+08:00', today: '2026-10-26', demo_clock: true }
const SONGSHAN = { id: 1, name: '松山車站', lat: 25.0498, lng: 121.5782 }
const WTC = { id: 2, name: '台北世貿中心', lat: 25.0331, lng: 121.5619 }

const LIVE: CityLive = {
  ...CLOCK,
  vehicles: [{ lat: 25.06, lng: 121.57, heading_deg: 10, on_board: 2, simulated: true }],
  counts: { vehicles: 34, on_board: 51, waiting: 9, matched: 6 },
  simulated_counts: { vehicles: 33, on_board: 50, waiting: 9, matched: 6 },
  pickup_points: [
    { ...SONGSHAN, waiting: 5, simulated_waiting: 5 },
    { ...WTC, waiting: 3, simulated_waiting: 3 },
  ],
  simulated: true,
}
const TODAY: CityToday = {
  ...CLOCK,
  completed: 47,
  requests: 55,
  matched: 47,
  match_rate: 0.8545,
  no_match: 8,
  trips_saved: 47,
  trips_saved_estimate: true,
  pickup_points: [
    { ...SONGSHAN, completed: 24 },
    { ...WTC, completed: 23 },
  ],
  simulated: true,
}
const WEATHER = { station_id: 'C0A9F0', station_name: '內湖', obs_time: '', weather: '雨', air_temperature: 23, precipitation: 4 }
const HISTORY: CityHistory = {
  ...CLOCK,
  days: [
    { date: '2026-10-23', weekday: 5, rides: 60, weather: WEATHER, simulated: true },
    { date: '2026-10-22', weekday: 4, rides: 40, weather: { ...WEATHER, weather: '晴', precipitation: 0 }, simulated: true },
  ],
  pickup_points: [
    { ...SONGSHAN, drivers_per_day: 31, passengers_per_day: 38.4, rides_per_day: 29.2 },
    { ...WTC, drivers_per_day: 20, passengers_per_day: 22, rides_per_day: 21.5 },
  ],
  simulated: true,
}
function gateway(vd_id: string, name: string, speed: number, past: number): CityGateway {
  return {
    vd_id,
    source: 'city',
    gateway: name,
    road_name: name,
    road_direction: 'N',
    bearing: 'N',
    lat: 25.07,
    lng: 121.57,
    shape: null,
    proxy: false,
    proxy_note: null,
    reference_speed_kmh: 60,
    volume: 500,
    avg_speed_kmh: speed,
    occupancy_pct: 10,
    coverage_pct: 100,
    past_avg_speed_kmh: past,
    simulated: true,
  }
}
function traffic(slot: string): CityTraffic {
  return {
    ...CLOCK,
    slot_start: slot,
    // 22 vs 31: more than 20% slower, red. 40 vs 45: not.
    detectors: [gateway('V1', '堤頂大道', 22, 31), gateway('V2', '環東大道', 40, 45)],
    weather: null,
    simulated: true,
    weather_simulated: true,
  }
}

type Responder = (path: string) => { status: number; body: unknown }
let respond: Responder
const calls: string[] = []

const ok: Responder = (path) => {
  if (path === '/api/city/live') return { status: 200, body: LIVE }
  if (path === '/api/city/today') return { status: 200, body: TODAY }
  if (path === '/api/city/history') return { status: 200, body: HISTORY }
  if (path.startsWith('/api/city/traffic')) {
    const slot = new URLSearchParams(path.split('?')[1]).get('slot')
    return { status: 200, body: traffic(slot ?? '2026-10-26T08:00:00+08:00') }
  }
  return { status: 403, body: { error: { code: 'forbidden', message: '此角色不能使用這個 API' } } }
}

beforeEach(() => {
  vi.useFakeTimers()
  calls.length = 0
  respond = ok
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    const { status, body } = respond(url)
    return new Response(JSON.stringify(body), { status })
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function renderApp() {
  render(<App />)
  await act(() => vi.advanceTimersByTimeAsync(0))
}

describe('city dashboard (SC-C1)', () => {
  it('shows the four areas from /api/city/* only, with the Demo clock in the top bar', async () => {
    await renderApp()
    expect(screen.getByText('現在 08:15')).toBeInTheDocument()
    expect(screen.getByText('10/26 星期一')).toBeInTheDocument()
    expect(screen.getByText('模擬時間')).toBeInTheDocument()

    const live = screen.getByRole('region', { name: '此刻在路上' })
    expect(within(live).getByText('34')).toBeInTheDocument()
    expect(within(live).getByText('含模擬')).toBeInTheDocument()
    expect(screen.getByText('等待 5')).toBeInTheDocument()

    const today = screen.getByRole('region', { name: '今日成效' })
    expect(within(today).getByText('估算')).toBeInTheDocument()
    expect(within(today).getByText('85%')).toBeInTheDocument()
    expect(within(today).getByText('8')).toBeInTheDocument()

    expect(screen.getByRole('region', { name: '過去 10 個上班日的共乘數' })).toBeInTheDocument()
    expect(calls.every((c) => c.startsWith('/api/city/'))).toBe(true)
  })

  it('without demo_clock there is no 模擬時間 mark', async () => {
    respond = (path) => {
      const r = ok(path)
      return { ...r, body: { ...(r.body as object), demo_clock: false } }
    }
    await renderApp()
    expect(screen.queryByText('模擬時間')).not.toBeInTheDocument()
  })

  it('shows no permission for an account that is not a city admin', async () => {
    respond = () => ({ status: 403, body: { error: { code: 'forbidden', message: '此帳號沒有該角色' } } })
    await renderApp()
    expect(screen.getByRole('alert')).toHaveTextContent('這個帳號沒有市府管理的權限。')
    expect(screen.queryByRole('region', { name: '今日成效' })).not.toBeInTheDocument()
  })

  it('a failing area shows a short error and keeps its last data', async () => {
    await renderApp()
    respond = (path) => (path === '/api/city/live' ? { status: 500, body: { error: { code: 'internal', message: 'x' } } } : ok(path))
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS))
    expect(screen.getByText('即時資料讀取失敗，顯示上一次的資料')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '此刻在路上' })).getByText('34')).toBeInTheDocument()
  })

  it('marks the road 20% or more slower in red, and only that one', async () => {
    await renderApp()
    expect(screen.getByText('堤頂大道').closest('tr')).toHaveClass('text-danger')
    expect(screen.getByText('環東大道').closest('tr')).not.toHaveClass('text-danger')
  })

  it('pickup table: per-day averages labelled, 沒搭到 = 乘客 − 載客, the most in red', async () => {
    await renderApp()
    const table = screen.getByRole('region', { name: '各上車點' })
    expect(within(table).getByText('平均每天（過去 10 個上班日）')).toBeInTheDocument()
    const rows = within(table).getAllByRole('row').slice(2)
    expect(within(rows[0]).getByTestId('missed')).toHaveTextContent('9.2')
    expect(within(rows[1]).getByTestId('missed')).toHaveTextContent('0.5')
    expect(rows[0]).toHaveClass('text-danger')
    expect(rows[1]).not.toHaveClass('text-danger')
    expect(within(rows[0]).getByText('24')).toBeInTheDocument()
  })

  it('history bars run oldest to newest with today last, in board ink', async () => {
    await renderApp()
    const days = screen.getAllByTestId('history-day')
    expect(days.map((d) => d.textContent)).toEqual([expect.stringContaining('10/22'), expect.stringContaining('10/23')])
    expect(within(days[1]).getByRole('img', { name: '雨' })).toBeInTheDocument()
    const today = screen.getByTestId('history-today')
    expect(today).toHaveTextContent('今天')
    expect(today).toHaveTextContent('47')
    expect(today.querySelector('.bg-ink')).not.toBeNull()
  })

  it('traffic: date then slot; picking a past slot asks for it and updates the speeds', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '車流' }))
    const [date, time] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    expect(date.value).toBe('2026-10-26')
    expect(time.value).toBe('08:00')
    // Today stops at the latest slot.
    expect(within(time).getAllByRole('option')).toHaveLength(5)

    fireEvent.change(date, { target: { value: '2026-10-23' } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(calls.at(-1)).toBe(`/api/city/traffic?slot=${encodeURIComponent('2026-10-23T08:00:00+08:00')}`)
    expect(within(screen.getAllByRole('combobox')[1]).getAllByRole('option')).toHaveLength(12)
    expect(screen.getByText(/主要道路車速 10\/23/)).toBeInTheDocument()
  })

  it('traffic: back to the latest slot, the past slot still on screen does not move the latest slot', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '車流' }))
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '2026-10-23' } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '09:30' } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText(/主要道路車速 10\/23/)).toBeInTheDocument()

    // The latest slot's response has not come back yet; 10/23 09:30 is still the shown data.
    const held = respond
    respond = (path) => (path === '/api/city/traffic' ? { status: 503, body: { error: { code: 'unavailable', message: '' } } } : held(path))
    // 09:30 is not a slot of today, so the time falls back to the latest slot, 08:00.
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '2026-10-26' } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    const [date, time] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    expect(date.value).toBe('2026-10-26')
    expect(time.value).toBe('08:00')
    expect(within(time).getAllByRole('option')).toHaveLength(5)
  })
})
