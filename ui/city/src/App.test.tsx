import type { CityGateway, CityHistory, CityLive, CityToday, CityTraffic, CityTrafficDay } from '@carpool/shared'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { LIVE_POLL_MS, TRAFFIC_POLL_MS } from './config'

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
    sort_order: vd_id === 'V1' ? 1 : 2,
    location_note: '區界外',
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
    past_min_speed_kmh: past - 5,
    past_max_speed_kmh: past + 5,
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
const SLOT_TIMES = ['07:00', '07:15', '07:30', '07:45', '08:00', '08:15', '08:30', '08:45', '09:00', '09:15', '09:30', '09:45']
/** Today at 08:15: 07:00-08:00 have traffic, the rest only the past speeds (4.18). 堤頂大道 22/60 = 37%: 壅塞. */
function trafficDay(): CityTrafficDay {
  return {
    ...CLOCK,
    date: CLOCK.today,
    slots: SLOT_TIMES.map((t, s) => {
      const over = s <= 4
      const notYet = (g: CityGateway): CityGateway => ({ ...g, volume: null, avg_speed_kmh: null, occupancy_pct: null, coverage_pct: null, simulated: false })
      const detectors = [gateway('V1', '堤頂大道', 22, 31), gateway('V2', '環東大道', 50, 45)]
      return {
        slot_start: `2026-10-26T${t}:00+08:00`,
        detectors: over ? detectors : detectors.map(notYet),
        weather: null,
        simulated: over,
        weather_simulated: over,
      }
    }),
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
  if (path === '/api/city/traffic?date=2026-10-26') return { status: 200, body: trafficDay() }
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

const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))

describe('city war room (SC-C1, UD-27)', () => {
  it('opens on 總覽 with the full product name, the Demo clock and /api/city/* only', async () => {
    await renderApp()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('內科上班順起來: 內科順路共乘市府戰情室')
    expect(screen.getByRole('tab', { name: '總覽' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('08:15')).toBeInTheDocument()
    expect(screen.getByText('10/26 週一')).toBeInTheDocument()
    expect(screen.getByText('模擬時間')).toBeInTheDocument()
    expect(calls.every((c) => c.startsWith('/api/city/'))).toBe(true)
    expect(calls).toContain('/api/city/traffic?date=2026-10-26')
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
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('top bar lights: one block per gateway in the latest slot, the worst level and its count (DD-44)', async () => {
    await renderApp()
    const lights = screen.getByTestId('network-lights')
    // 堤頂大道 22/60 = 37% 壅塞; 環東大道 50/60 = 83% 順暢.
    expect([...lights.querySelectorAll('[data-level]')].map((e) => e.getAttribute('data-level'))).toEqual(['3', '1'])
    expect(lights).toHaveTextContent('2 個入口')
    expect(lights).toHaveTextContent('壅塞 1 處')
  })

  it('number row: trips saved marked 估算, the rest from /api/city/live and /api/city/today, marked 含模擬', async () => {
    await renderApp()
    const value = (name: string) => within(screen.getByRole('region', { name })).getByTestId('kpi-value')
    expect(within(screen.getByRole('region', { name: '估計減少的車次' })).getByText('估算')).toBeInTheDocument()
    expect(value('估計減少的車次')).toHaveTextContent('47')
    expect(value('路上的共乘車')).toHaveTextContent('34')
    expect(value('等待配對')).toHaveTextContent('9')
    expect(value('成功配對')).toHaveTextContent('85')
    expect(value('無車可配')).toHaveTextContent('8')
    expect(screen.getByRole('region', { name: '路上的共乘車' })).toHaveTextContent('車上 51 位乘客')
    expect(within(screen.getByRole('region', { name: '成功配對' })).getByText('含模擬')).toBeInTheDocument()
  })

  it("grid: a row per gateway, 12 cells; after 08:00 they are 還沒到; today's grid marked 模擬", async () => {
    await renderApp()
    const grid = screen.getByRole('region', { name: '入口 × 15 分鐘' })
    expect(within(grid).getByText('今天：模擬')).toBeInTheDocument()
    expect(within(grid).getAllByRole('rowheader')).toHaveLength(2)
    const cells = within(grid).getAllByRole('gridcell')
    expect(cells).toHaveLength(24)
    expect(cells.slice(0, 12).map((c) => c.getAttribute('data-kind'))).toEqual([...Array(5).fill('data'), ...Array(7).fill('not-yet')])
    expect(cells[5]).toHaveAccessibleName(/還沒到/)
    expect(cells[0]).toHaveAttribute('data-level', '3')
    expect(within(grid).getByRole('heading')).toHaveTextContent('堤頂大道 07:00–08:15 最慢')
  })

  it('clicking a past cell opens 車流熱力 at that slot; a not-yet cell opens the latest slot', async () => {
    await renderApp()
    const cells = () => within(screen.getByRole('region', { name: '入口 × 15 分鐘' })).getAllByRole('gridcell')
    fireEvent.click(cells()[2]) // 07:30
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('tab', { name: '車流熱力' })).toHaveAttribute('aria-selected', 'true')
    const [date, time] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    expect([date.value, time.value]).toEqual(['2026-10-26', '07:30'])
    expect(calls.at(-1)).toBe(`/api/city/traffic?slot=${encodeURIComponent('2026-10-26T07:30:00+08:00')}`)

    tab('總覽')
    fireEvent.click(cells()[9]) // 09:15, not yet
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('08:00')
  })

  it("today's requests match /api/city/today and /api/city/live", async () => {
    await renderApp()
    const box = screen.getByRole('region', { name: '今天的請求' })
    expect(within(box).getByTestId('bar-送出請求')).toHaveTextContent('55')
    expect(within(box).getByTestId('bar-配到車')).toHaveTextContent('47')
    expect(within(box).getByTestId('bar-已完成')).toHaveTextContent('47')
    expect(within(box).getByTestId('no-match')).toHaveTextContent('8')
    expect(within(box).getByTestId('still-waiting')).toHaveTextContent('9')
    expect(within(box).getByText('含模擬')).toBeInTheDocument()
  })

  it('switching tabs does not refetch; the live map tab shows the four numbers and the pickup points', async () => {
    await renderApp()
    const before = calls.length
    tab('即時地圖')
    tab('總覽')
    tab('即時地圖')
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(calls.length).toBe(before)
    const counts = screen.getByRole('region', { name: '此刻在路上' })
    expect(counts).toHaveTextContent('34')
    expect(within(counts).getByText('含模擬')).toBeInTheDocument()
    expect(screen.getByLabelText('松山車站 等待 5 人')).toBeInTheDocument()
    expect(screen.getByText('等待 5')).toBeInTheDocument()
    // The cars keep moving: live polls on while on this tab.
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS))
    expect(calls.filter((c) => c === '/api/city/live').length).toBeGreaterThan(1)
  })

  it('a failing area shows a short error and keeps its last data; the others are untouched', async () => {
    await renderApp()
    respond = (path) => (path.includes('date=') ? { status: 500, body: { error: { code: 'internal', message: 'x' } } } : ok(path))
    await act(() => vi.advanceTimersByTimeAsync(TRAFFIC_POLL_MS))
    const grid = screen.getByRole('region', { name: '入口 × 15 分鐘' })
    expect(within(grid).getByRole('alert')).toHaveTextContent('車流資料讀取失敗，顯示上一次的資料')
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(24)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('pickup table: per-day averages labelled, 沒搭到 = 乘客 − 載客, the most in red and in the headline', async () => {
    await renderApp()
    const table = screen.getByRole('region', { name: '各上車點' })
    expect(within(table).getByText('平均每天（過去 10 個上班日）')).toBeInTheDocument()
    expect(within(table).getByRole('heading')).toHaveTextContent('松山車站沒搭到最多：駕駛不夠')
    const rows = within(table).getAllByRole('row').slice(2)
    expect(within(rows[0]).getByTestId('missed')).toHaveTextContent('9.2')
    expect(within(rows[1]).getByTestId('missed')).toHaveTextContent('0.5')
    expect(rows[0]).toHaveClass('text-danger')
    expect(rows[1]).not.toHaveClass('text-danger')
    expect(within(rows[0]).getByText('24')).toBeInTheDocument()
  })

  it('history bars run oldest to newest with today last, in board ink; the busiest day is the headline', async () => {
    await renderApp()
    const days = screen.getAllByTestId('history-day')
    expect(days.map((d) => d.textContent)).toEqual([expect.stringContaining('10/22'), expect.stringContaining('10/23')])
    expect(within(days[1]).getByRole('img', { name: '雨' })).toBeInTheDocument()
    const today = screen.getByTestId('history-today')
    expect(today).toHaveTextContent('今天')
    expect(today).toHaveTextContent('47')
    expect(today.querySelector('.bg-ink')).not.toBeNull()
    expect(within(screen.getByRole('region', { name: '過去 10 個上班日的共乘數' })).getByRole('heading')).toHaveTextContent('10/23 週五最多，60 趟')
  })

  it('車流熱力 keeps T41: date then slot; picking a past slot asks for it', async () => {
    await renderApp()
    tab('車流熱力')
    const [date, time] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    expect(date.value).toBe('2026-10-26')
    expect(time.value).toBe('08:00')
    expect(within(time).getAllByRole('option')).toHaveLength(5)
    fireEvent.change(date, { target: { value: '2026-10-23' } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(calls.at(-1)).toBe(`/api/city/traffic?slot=${encodeURIComponent('2026-10-23T08:00:00+08:00')}`)
    expect(screen.getByText(/主要道路車速 10\/23/)).toBeInTheDocument()
    expect(screen.getByText('堤頂大道').closest('tr')).toHaveClass('text-danger')
  })
})
