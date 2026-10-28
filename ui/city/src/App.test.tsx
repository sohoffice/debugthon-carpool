import type { CityGateway, CityHistory, CityLive, CityToday, CityTrafficDay } from '@carpool/shared'
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
    { date: '2026-10-23', weekday: 5, rides: 60, weather: WEATHER, simulated: true, traffic_simulated: true },
    { date: '2026-10-22', weekday: 4, rides: 40, weather: { ...WEATHER, weather: '晴', precipitation: 0 }, simulated: true, traffic_simulated: false },
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
const SLOT_TIMES = ['07:00', '07:15', '07:30', '07:45', '08:00', '08:15', '08:30', '08:45', '09:00', '09:15', '09:30', '09:45']
/**
 * A day's 12 slots: today at 08:15 has traffic 07:00-08:00 and only the past speeds after (4.18);
 * 10/22 is TDX measured all morning (simulated false), 10/23 simulated. 堤頂大道 22/60 = 37%: 壅塞.
 */
function trafficDay(date = CLOCK.today): CityTrafficDay {
  const isToday = date === CLOCK.today
  const simulated = date !== '2026-10-22'
  return {
    ...CLOCK,
    date,
    slots: SLOT_TIMES.map((t, s) => {
      const over = !isToday || s <= 4
      const notYet = (g: CityGateway): CityGateway => ({ ...g, volume: null, avg_speed_kmh: null, occupancy_pct: null, coverage_pct: null, simulated: false })
      // On 10/22 環東大道 is the slower one at 08:30 (20/60 = 33%).
      const slow = date === '2026-10-22' && t === '08:30'
      const detectors = [gateway('V1', '堤頂大道', slow ? 40 : 22, 31), gateway('V2', '環東大道', slow ? 20 : 50, 45)].map((g) => ({ ...g, simulated: over && simulated }))
      return {
        slot_start: `${date}T${t}:00+08:00`,
        detectors: over ? detectors : detectors.map(notYet),
        weather: over ? WEATHER : null,
        simulated: over && simulated,
        weather_simulated: over,
      }
    }),
    simulated,
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
  const date = path.match(/^\/api\/city\/traffic\?date=(\d{4}-\d{2}-\d{2})$/)?.[1]
  if (date) return { status: 200, body: trafficDay(date) }
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
const dateMenu = () => screen.getByRole('combobox', { name: '日期' }) as HTMLSelectElement
const slotButton = (name: string) => within(screen.getByRole('group', { name: '時段' })).getByRole('button', { name })
const selectedName = () => within(screen.getByRole('region', { name: '選取的入口' })).getByRole('heading')

describe('city war room (SC-C1, UD-27)', () => {
  it('opens on 總覽 with the full product name, the Demo clock and /api/city/* only', async () => {
    await renderApp()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('內科上班順起來: 內科順路共乘市府儀表板')
    expect(screen.getByRole('tab', { name: '總覽' })).toHaveAttribute('aria-selected', 'true')
    // The top bar's clock; the grid's slot headers also read 08:15.
    expect(within(screen.getByRole('banner')).getByText('08:15')).toBeInTheDocument()
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

  it('clicking a past cell opens 車流熱力 at that gateway and slot; a not-yet cell opens the latest slot', async () => {
    await renderApp()
    const cells = () => within(screen.getByRole('region', { name: '入口 × 15 分鐘' })).getAllByRole('gridcell')
    fireEvent.click(cells()[12 + 4]) // 環東大道 08:00
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('tab', { name: '車流熱力' })).toHaveAttribute('aria-selected', 'true')
    expect(slotButton('08:00–08:15')).toHaveAttribute('aria-pressed', 'true')
    expect(selectedName()).toHaveTextContent('2. 環東大道')

    tab('總覽')
    fireEvent.click(cells()[2]) // 堤頂大道 07:30
    expect(slotButton('07:30–07:45')).toHaveAttribute('aria-pressed', 'true')
    expect(selectedName()).toHaveTextContent('1. 堤頂大道')

    tab('總覽')
    fireEvent.click(cells()[12 + 9]) // 環東大道 09:15, not yet
    expect(slotButton('08:00–08:15')).toHaveAttribute('aria-pressed', 'true')
    expect(selectedName()).toHaveTextContent('2. 環東大道')
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
    const box = screen.getByRole('region', { name: '過去 10 個上班日的共乘數' })
    expect(within(box).getByRole('heading')).toHaveTextContent('10/23 週五最多，60 趟')
    expect(within(box).getByText('含模擬')).toBeInTheDocument()
  })

  it('車流熱力 opens on today, the latest slot, 路況, the slowest gateway selected; marked 模擬 (SC-C1)', async () => {
    await renderApp()
    tab('車流熱力')
    expect(dateMenu().value).toBe('2026-10-26')
    expect(slotButton('08:00–08:15')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '路況' })).toHaveAttribute('aria-pressed', 'true')
    expect(selectedName()).toHaveTextContent('1. 堤頂大道') // 22/60 = 37%, the lowest ratio
    expect(screen.getByTestId('map-slot')).toHaveTextContent('10/26 週一 08:00–08:15模擬')
    // 08:15 on today are not over yet: they cannot be picked (DD-41)
    expect(slotButton('08:15–08:30')).toBeDisabled()
    expect(slotButton('07:00–07:15')).toBeEnabled()
    // no blob heat map and no main-road speed table any more
    expect(screen.queryByText(/主要道路車速/)).not.toBeInTheDocument()
  })

  it('the date menu says where each day comes from; 10/22 is TDX 實測, all 12 slots open (UD-28)', async () => {
    await renderApp()
    tab('車流熱力')
    expect(within(dateMenu()).getAllByRole('option').map((o) => o.textContent)).toEqual(['10/26 週一（今天 · 模擬）', '10/23 週五 · 模擬', '10/22 週四 · 實測'])
    fireEvent.change(dateMenu(), { target: { value: '2026-10-22' } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(calls).toContain('/api/city/traffic?date=2026-10-22')
    expect(screen.getByTestId('map-slot')).toHaveTextContent('10/22 週四 08:00–08:15TDX 實測')
    expect(screen.getAllByRole('button', { name: /^\d\d:\d\d–/ }).every((b) => !(b as HTMLButtonElement).disabled)).toBe(true)
    fireEvent.change(dateMenu(), { target: { value: '2026-10-23' } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByTestId('map-slot')).toHaveTextContent('10/23 週五 08:00–08:15模擬')
  })

  it('the slowest three by speed ratio, coloured as the grid column; a cell changes gateway and slot, a row name only the gateway', async () => {
    await renderApp()
    tab('車流熱力')
    fireEvent.change(dateMenu(), { target: { value: '2026-10-22' } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    const slowest = () => within(screen.getByRole('region', { name: '最慢的 3 個入口' })).getAllByRole('listitem')
    expect(slowest().map((li) => li.textContent)).toEqual([expect.stringContaining('1. 堤頂大道'), expect.stringContaining('2. 環東大道')])
    const grid = () => screen.getByRole('grid', { name: '所選日期各入口每 15 分鐘的路況' })
    fireEvent.click(within(grid()).getAllByRole('gridcell')[12 + 6]) // 環東大道 08:30
    expect(slotButton('08:30–08:45')).toHaveAttribute('aria-pressed', 'true')
    expect(selectedName()).toHaveTextContent('2. 環東大道')
    expect(slowest()[0]).toHaveTextContent('2. 環東大道') // 20/60 at 08:30
    expect(within(slowest()[0]).getByText('壅塞 · 參考 33% · 平常 45')).toBeInTheDocument()
    // the same level as the grid's 08:30 column
    expect(within(grid()).getAllByRole('gridcell')[12 + 6]).toHaveAttribute('data-level', '3')
    fireEvent.click(within(grid()).getAllByRole('rowheader')[0])
    expect(selectedName()).toHaveTextContent('1. 堤頂大道')
    expect(slotButton('08:30–08:45')).toHaveAttribute('aria-pressed', 'true')
  })

  it('on 車流熱力 a cell without data still selects its gateway, the slot stays', async () => {
    respond = (path) => {
      const r = ok(path)
      if (!path.includes('date=')) return r
      const day = r.body as CityTrafficDay
      const gap = (g: CityGateway, t: string) => (g.vd_id === 'V2' && t.includes('T07:30') ? { ...g, avg_speed_kmh: null, volume: null } : g)
      return { ...r, body: { ...day, slots: day.slots.map((sl) => ({ ...sl, detectors: sl.detectors.map((g) => gap(g, sl.slot_start)) })) } }
    }
    await renderApp()
    tab('車流熱力')
    expect(selectedName()).toHaveTextContent('1. 堤頂大道')
    const cell = within(screen.getByRole('grid', { name: '所選日期各入口每 15 分鐘的路況' })).getAllByRole('gridcell')[12 + 2]
    expect(cell).toHaveAttribute('data-kind', 'none')
    fireEvent.click(cell)
    expect(selectedName()).toHaveTextContent('2. 環東大道')
    expect(slotButton('08:00–08:15')).toHaveAttribute('aria-pressed', 'true')
  })

  it('比平常 colours by the other days at the same time; 還沒到 is 差不多 (DD-44)', async () => {
    await renderApp()
    tab('車流熱力')
    fireEvent.click(screen.getByRole('button', { name: '比平常' }))
    const cells = within(screen.getByRole('grid', { name: '所選日期各入口每 15 分鐘的路況' })).getAllByRole('gridcell')
    // 堤頂大道 22 vs 31: 29% slower; 環東大道 50 vs 45: 11% faster
    expect(cells[0]).toHaveAttribute('data-level', '4')
    expect(cells[12]).toHaveAttribute('data-level', '1')
    expect(cells[8]).toHaveAttribute('data-level', '2') // 09:00, not yet
    expect(screen.getByLabelText('圖例')).toHaveTextContent('慢 25% 以上')
  })

  it('a proxy gateway has * and its detector place in the right column', async () => {
    respond = (path) => {
      const r = ok(path)
      if (!path.includes('date=')) return r
      const day = r.body as CityTrafficDay
      const proxy = (g: CityGateway) => (g.vd_id === 'V1' ? { ...g, gateway: '成美橋', proxy: true, proxy_note: '橋北端的新明路' } : g)
      return { ...r, body: { ...day, slots: day.slots.map((sl) => ({ ...sl, detectors: sl.detectors.map(proxy) })) } }
    }
    await renderApp()
    tab('車流熱力')
    expect(selectedName()).toHaveTextContent('1. 成美橋 *')
    expect(screen.getByRole('region', { name: '選取的入口' })).toHaveTextContent('代理值：偵測器在橋北端的新明路')
  })

  it('即時地圖 has 疊上車流, off by default', async () => {
    await renderApp()
    tab('即時地圖')
    const box = screen.getByRole('checkbox', { name: '疊上車流' })
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    expect(box).toBeChecked()
  })
  describe('below 1024px (T71, T72)', () => {
    // jsdom has no layout: a 300px time-key row holding 12 keys of 56px, one every 57px.
    function narrowKeys() {
      const isRow = (el: HTMLElement) => el.getAttribute('aria-label') === '時段'
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return isRow(this) ? 300 : 0
      })
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return isRow(this) ? 12 * 57 : 0
      })
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(56)
      vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
        return SLOT_TIMES.indexOf(this.textContent ?? '') * 57
      })
    }
    afterEach(() => vi.restoreAllMocks())

    it('the selected time key scrolls into the middle of its row, also after picking another slot', async () => {
      narrowKeys()
      await renderApp()
      tab('車流熱力')
      const keys = screen.getByRole('group', { name: '時段' })
      // 08:00 is the 5th key: 4 × 57 − (300 − 56) / 2 = 106.
      expect(keys.scrollLeft).toBe(106)
      fireEvent.click(slotButton('07:00–07:15'))
      expect(keys.scrollLeft).toBe(-122)
    })

    it('the time keys do not scroll when they all fit (desktop)', async () => {
      await renderApp()
      tab('車流熱力')
      expect(screen.getByRole('group', { name: '時段' }).scrollLeft).toBe(0)
    })

    describe('a grid cell is picked first, then opened with a 44px button (T85, REQ-079)', () => {
      // Only the narrow query matches, so reduced motion and the rest stay off.
      beforeEach(() => {
        vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: media === '(max-width: 63.99rem)', addEventListener() {}, removeEventListener() {} }))
      })
      const bar = (region: string) => within(screen.getByRole('region', { name: region })).getByTestId('cell-pick')
      const overviewCells = () => within(screen.getByRole('region', { name: '入口 × 15 分鐘' })).getAllByRole('gridcell')

      it('總覽: before a tap the bar asks for one and its button is off', async () => {
        await renderApp()
        expect(bar('入口 × 15 分鐘')).toHaveTextContent('點一格選取入口與時段')
        expect(within(bar('入口 × 15 分鐘')).getByRole('button', { name: '看車流熱力 →' })).toBeDisabled()
      })

      it('總覽: a tap only picks the cell and names it; the button opens 車流熱力 at that gateway and slot', async () => {
        await renderApp()
        fireEvent.click(overviewCells()[12 + 4]) // 環東大道 08:00
        expect(screen.getByRole('tab', { name: '總覽' })).toHaveAttribute('aria-selected', 'true')
        expect(overviewCells()[12 + 4]).toHaveAttribute('data-picked', 'true')
        expect(overviewCells().filter((c) => c.hasAttribute('data-picked'))).toHaveLength(1)
        expect(bar('入口 × 15 分鐘')).toHaveTextContent('2. 環東大道 08:00–08:15 · 順暢')

        fireEvent.click(overviewCells()[1]) // 堤頂大道 07:15: picking again moves the pick
        expect(bar('入口 × 15 分鐘')).toHaveTextContent('1. 堤頂大道 07:15–07:30 · 壅塞')
        expect(overviewCells()[12 + 4]).not.toHaveAttribute('data-picked')

        fireEvent.click(within(bar('入口 × 15 分鐘')).getByRole('button', { name: '看車流熱力 →' }))
        expect(screen.getByRole('tab', { name: '車流熱力' })).toHaveAttribute('aria-selected', 'true')
        expect(slotButton('07:15–07:30')).toHaveAttribute('aria-pressed', 'true')
        expect(selectedName()).toHaveTextContent('1. 堤頂大道')
      })

      it('總覽: a cell not over yet says 還沒到 and still opens the latest slot', async () => {
        await renderApp()
        fireEvent.click(overviewCells()[12 + 9]) // 環東大道 09:15
        expect(bar('入口 × 15 分鐘')).toHaveTextContent('2. 環東大道 09:15–09:30 · 還沒到')
        fireEvent.click(within(bar('入口 × 15 分鐘')).getByRole('button', { name: '看車流熱力 →' }))
        expect(slotButton('08:00–08:15')).toHaveAttribute('aria-pressed', 'true')
        expect(selectedName()).toHaveTextContent('2. 環東大道')
      })

      it('車流熱力: a tap only picks; 在地圖上看 changes the map to that gateway and slot and goes up to it', async () => {
        await renderApp()
        tab('車流熱力')
        const cells = () => within(screen.getByRole('grid', { name: '所選日期各入口每 15 分鐘的路況' })).getAllByRole('gridcell')
        fireEvent.click(cells()[12 + 2]) // 環東大道 07:30
        expect(selectedName()).toHaveTextContent('1. 堤頂大道')
        expect(slotButton('08:00–08:15')).toHaveAttribute('aria-pressed', 'true')
        expect(bar('入口 × 15 分鐘（車流熱力）')).toHaveTextContent('2. 環東大道 07:30–07:45 · 順暢')

        document.documentElement.scrollTop = 900
        Object.defineProperty(document, 'scrollingElement', { value: document.documentElement, configurable: true })
        fireEvent.click(within(bar('入口 × 15 分鐘（車流熱力）')).getByRole('button', { name: '在地圖上看 ↑' }))
        expect(selectedName()).toHaveTextContent('2. 環東大道')
        expect(slotButton('07:30–07:45')).toHaveAttribute('aria-pressed', 'true')
        expect(document.documentElement.scrollTop).toBe(0)
      })

      it('車流熱力: after a date change the bar reads the picked cell on the new date (T85 review)', async () => {
        await renderApp()
        tab('車流熱力')
        const cells = () => within(screen.getByRole('grid', { name: '所選日期各入口每 15 分鐘的路況' })).getAllByRole('gridcell')
        fireEvent.click(cells()[12 + 6]) // 環東大道 08:30: not over yet today
        expect(bar('入口 × 15 分鐘（車流熱力）')).toHaveTextContent('2. 環東大道 08:30–08:45 · 還沒到')
        fireEvent.change(dateMenu(), { target: { value: '2026-10-22' } })
        await act(() => vi.advanceTimersByTimeAsync(0))
        // On 10/22 it has data, 20/60: the bar and the button follow the cell under the outline.
        expect(cells()[12 + 6]).toHaveAttribute('data-picked', 'true')
        expect(cells()[12 + 6]).toHaveAttribute('data-level', '3')
        expect(bar('入口 × 15 分鐘（車流熱力）')).toHaveTextContent('2. 環東大道 08:30–08:45 · 壅塞')
        fireEvent.click(within(bar('入口 × 15 分鐘（車流熱力）')).getByRole('button', { name: '在地圖上看 ↑' }))
        expect(selectedName()).toHaveTextContent('2. 環東大道')
        expect(slotButton('08:30–08:45')).toHaveAttribute('aria-pressed', 'true')
      })

      it('總覽: a poll that brings the next slot updates the picked cell from 還沒到 (T85 review)', async () => {
        await renderApp()
        fireEvent.click(overviewCells()[5]) // 堤頂大道 08:15, not over yet
        expect(bar('入口 × 15 分鐘')).toHaveTextContent('1. 堤頂大道 08:15–08:30 · 還沒到')
        const later = { ...CLOCK, now: '2026-10-26T08:30:00+08:00' }
        respond = (path) => {
          const r = ok(path)
          if (!path.startsWith('/api/city/traffic')) return r
          const day = r.body as CityTrafficDay
          return { ...r, body: { ...day, ...later, slots: day.slots.map((sl, i) => (i === 5 ? trafficDay('2026-10-23').slots[5] : sl)) } }
        }
        await act(() => vi.advanceTimersByTimeAsync(TRAFFIC_POLL_MS))
        expect(overviewCells()[5]).toHaveAttribute('data-kind', 'data')
        expect(bar('入口 × 15 分鐘')).toHaveTextContent('1. 堤頂大道 08:15–08:30 · 壅塞')
      })

      it('車流熱力: the bar follows 比平常', async () => {
        await renderApp()
        tab('車流熱力')
        fireEvent.click(screen.getByRole('button', { name: '比平常' }))
        fireEvent.click(within(screen.getByRole('grid', { name: '所選日期各入口每 15 分鐘的路況' })).getAllByRole('gridcell')[0])
        expect(bar('入口 × 15 分鐘（車流熱力）')).toHaveTextContent('1. 堤頂大道 07:00–07:15 · 慢 25% 以上')
      })
    })

    it('desktop: one tap still opens 車流熱力, with no pick bar (T85)', async () => {
      await renderApp()
      expect(screen.queryByTestId('cell-pick')).toBeNull()
      fireEvent.click(within(screen.getByRole('region', { name: '入口 × 15 分鐘' })).getAllByRole('gridcell')[12 + 4])
      expect(screen.getByRole('tab', { name: '車流熱力' })).toHaveAttribute('aria-selected', 'true')
      expect(selectedName()).toHaveTextContent('2. 環東大道')
    })

    it('a grid cell opens 車流熱力 at the top of the page, not where 總覽 was scrolled to', async () => {
      await renderApp()
      document.documentElement.scrollTop = 900
      Object.defineProperty(document, 'scrollingElement', { value: document.documentElement, configurable: true })
      fireEvent.click(within(screen.getByRole('region', { name: '入口 × 15 分鐘' })).getAllByRole('gridcell')[2])
      expect(screen.getByRole('tab', { name: '車流熱力' })).toHaveAttribute('aria-selected', 'true')
      expect(document.documentElement.scrollTop).toBe(0)
      expect(selectedName()).toHaveTextContent('1. 堤頂大道')
    })
  })
})
