import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../api/client'
import { ApiError } from '../api/client'
import type { CommuteTraffic, CommuteWeather, PickupPoint, PickupRides, RideDay, WeatherObservation } from '../api/types'
import { CommuteInfo } from './CommuteInfo'

// The Demo day: Saturday 10/24 under demo_clock, so today is Monday 10/26 at 08:15 (DD-41).
const DATES = ['2026-10-23', '2026-10-22', '2026-10-21', '2026-10-20', '2026-10-19', '2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12']
const WEEKDAYS = [5, 4, 3, 2, 1, 5, 4, 3, 2, 1]
const NOW = '2026-10-26T08:15:00+08:00'
const SLOT_TIMES = ['07:00', '07:15', '07:30', '07:45', '08:00', '08:15', '08:30', '08:45', '09:00', '09:15', '09:30', '09:45']
const POINTS: PickupPoint[] = [
  { id: 1, name: '松山車站', lat: 25.0498, lng: 121.5782, radius_m: 80 },
  { id: 2, name: '台北世貿中心', lat: 25.0331, lng: 121.5619, radius_m: 80 },
]

/** 10/22 rains from 07:30, hardest at 08:00; one weather per slot like traffic_observations (DD-36). */
function weatherAt(date: string, slot: number): WeatherObservation {
  const rain = date === '2026-10-22' && slot >= 2 ? (slot === 4 ? 3.4 : 1.1) : 0
  const sky = rain > 0 ? '陰有雨' : date === '2026-10-22' ? '陰' : WEEKDAYS[DATES.indexOf(date)] % 2 ? '晴' : '多雲'
  return { station_id: 'C0A9F0', station_name: '內湖', obs_time: `${date}T${SLOT_TIMES[slot]}:00+08:00`, weather: sky, air_temperature: 18.4, precipitation: rain }
}
const at = (date: string, slot: number) => `${date}T${SLOT_TIMES[slot]}:00+08:00`

/** Rides differ by pickup point; 07:00 is 0 (a blank cell) on every day. */
const rideCount = (pickupId: number, day: number, slot: number) => (slot === 0 ? 0 : ((day * 3 + slot * 5 + pickupId) % 9) + (pickupId === 2 ? 10 : 0))

function ridesFor(pickupId: number, from: string, to: string): PickupRides {
  const days: RideDay[] = DATES.map((date, d) => ({
    date,
    weekday: WEEKDAYS[d],
    slots: SLOT_TIMES.map((_, s) => ({ slot_start: at(date, s), ride_count: rideCount(pickupId, d, s), weather: weatherAt(date, s), simulated: true })),
  }))
  // The backend's summary (summarizeRides): from included, to not.
  const inWindow = (d: RideDay) => d.slots.filter((s) => s.slot_start.slice(11, 16) >= from && s.slot_start.slice(11, 16) < to).reduce((n, s) => n + s.ride_count, 0)
  const totals = days.map(inWindow)
  const mondays = days.flatMap((d, i) => (d.weekday === 1 ? [totals[i]] : []))
  return {
    now: NOW,
    pickup_point_id: pickupId,
    days,
    today: { date: '2026-10-26', weekday: 1, slots: [] },
    summary: { from, to, daily_avg: totals.reduce((a, b) => a + b, 0) / 10, weekday: 1, same_weekday_avg: mondays.reduce((a, b) => a + b, 0) / mondays.length },
    simulated: true,
  }
}

const TRAFFIC: CommuteTraffic = {
  now: NOW,
  today: '2026-10-26',
  days: DATES.map((date, d) => ({
    date,
    weekday: WEEKDAYS[d],
    slots: SLOT_TIMES.map((_, s) => ({
      slot_start: at(date, s),
      volume: 900 + s * 37 + d * 11,
      // No car passed 10/12 09:45: the backend's null speed.
      avg_speed_kmh: date === '2026-10-12' && s === 11 ? null : 40 - s * 1.4,
      weather: weatherAt(date, s),
      simulated: true,
    })),
  })),
  simulated: true,
}
TRAFFIC.days[1].slots[5] = { ...TRAFFIC.days[1].slots[5], volume: 1284, avg_speed_kmh: 22.6 }

const WEATHER: CommuteWeather = {
  now: NOW,
  today: '2026-10-26',
  weather: { station_id: 'C0A9F0', station_name: '內湖', obs_time: '2026-10-26T08:10:00+08:00', weather: '陰有雨', air_temperature: 18.2, precipitation: 0.8 },
  simulated: true,
}

interface FakeOptions {
  now?: string
  down?: ('/commute/weather' | '/commute/traffic' | '/commute/pickup-rides' | '/pickup-points')[]
  /** pickup-rides fails only after this many answers (a later change of window or pickup point). */
  ridesDownAfter?: number
}

/** An ApiClient answering like the Go backend; `down` paths fail with a 500. */
function fakeApi({ now = NOW, down = [], ridesDownAfter }: FakeOptions = {}) {
  const calls: string[] = []
  let ridesAnswered = 0
  const get = vi.fn(async (path: string) => {
    calls.push(path)
    const [pathname, qs] = path.split('?')
    if (down.some((d) => d === pathname)) throw new ApiError(500, '伺服器發生錯誤', 'internal')
    if (pathname === '/commute/weather') return { ...WEATHER, now }
    if (pathname === '/commute/traffic') return { ...TRAFFIC, now }
    if (pathname === '/pickup-points') return POINTS
    if (pathname === '/commute/pickup-rides') {
      if (ridesDownAfter !== undefined && ridesAnswered++ >= ridesDownAfter) throw new ApiError(500, '伺服器發生錯誤', 'internal')
      const q = new URLSearchParams(qs)
      return { ...ridesFor(Number(q.get('pickup_point_id')), q.get('from')!, q.get('to')!), now }
    }
    throw new ApiError(404, 'not found', 'not_found')
  })
  const api = { get, post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as ApiClient
  return { api, calls }
}

function show(options: FakeOptions & { ground?: 'light' | 'asphalt'; pickupId?: number | null } = {}) {
  const fake = fakeApi(options)
  const onBack = vi.fn()
  render(<CommuteInfo api={fake.api} ground={options.ground ?? 'light'} defaultPickupId={options.pickupId ?? 1} onBack={onBack} />)
  return { ...fake, onBack }
}

const grid = (name: '載客次數' | '內湖車流') => screen.getByRole('group', { name })
/** Each row's label text: date, weekday and the weather icon's name. */
function rowLabels(name: '載客次數' | '內湖車流') {
  const cells = [...grid(name).children].filter((el) => !el.hasAttribute('aria-hidden') && el.tagName === 'SPAN' && el.textContent?.includes('週'))
  return cells.map((el) => `${el.textContent} ${el.querySelector('svg')?.getAttribute('aria-label') ?? ''}`)
}
const rideCells = () => within(grid('載客次數')).getAllByRole('img').filter((el) => el.getAttribute('aria-label')?.includes('載客'))
const trafficCells = () => within(grid('內湖車流')).getAllByRole('button')
const frame = (scale: 'ride' | 'road') => {
  const el = screen.getByTestId(`${scale}-window`)
  return [Number(el.dataset.from), Number(el.dataset.to)]
}
/** The line under the traffic grid; textContent keeps its full-width spaces exact. */
const detailLine = () => screen.getByText((_, el) => el?.tagName === 'P' && el.getAttribute('aria-live') === 'polite').textContent
const ridesShown = async () => screen.findByRole('group', { name: '載客次數' })

afterEach(() => vi.useRealTimers())

describe('CommuteInfo (DD-38, UD-25, SC-X4)', () => {
  it('shows today’s weather, and both grids with 10 rows 10/23-10/12 of 12 slots each (REQ-056, REQ-077)', async () => {
    show()
    const weather = await screen.findByRole('region', { name: '今天的天氣' })
    expect(weather).toHaveTextContent('陰有雨 18°C')
    expect(weather).toHaveTextContent('內湖站 08:10 觀測')
    expect(weather).toHaveTextContent('今天10/26 週一')
    await ridesShown()
    await screen.findByRole('group', { name: '內湖車流' })

    for (const name of ['載客次數', '內湖車流'] as const) {
      const rows = rowLabels(name)
      expect(rows).toHaveLength(10)
      expect(rows.map((r) => r.split(' ').slice(0, 2).join(' '))).toEqual([
        '10/23 週五', '10/22 週四', '10/21 週三', '10/20 週二', '10/19 週一', '10/16 週五', '10/15 週四', '10/14 週三', '10/13 週二', '10/12 週一',
      ])
      // Every row has a weather icon.
      expect(rows.every((r) => /晴|多雲|雨$/.test(r))).toBe(true)
    }
    expect(rideCells()).toHaveLength(120)
    expect(trafficCells()).toHaveLength(120)
  })

  it('a day has the same weather on both grids: its rainiest slot (REQ-083, DD-38)', async () => {
    show()
    await ridesShown()
    await screen.findByRole('group', { name: '內湖車流' })
    expect(rowLabels('載客次數')).toEqual(rowLabels('內湖車流'))
    // 10/22 is cloudy at 07:00 but rains from 07:30: the rain stands for the day.
    expect(rowLabels('載客次數')[1]).toBe('10/22 週四 雨')
  })

  it('defaults to now ± 30 minutes from the API’s now, 07:45–08:45 at the Demo clock, whatever the device time (DD-41)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-24T15:40:00+08:00') })
    const { calls } = show()
    expect(await screen.findByRole('button', { name: /時段\s*07:45–08:45/ })).toBeInTheDocument()
    await ridesShown()
    expect(calls).toContain('/commute/pickup-rides?pickup_point_id=1&from=07:45&to=08:45')
  })

  it('defaults to 08:00–08:30 when now is outside commute hours (no demo_clock, opened in the afternoon, DD-38)', async () => {
    const { calls } = show({ now: '2026-10-23T15:20:00+08:00' })
    expect(await screen.findByRole('button', { name: /時段\s*08:00–08:30/ })).toBeInTheDocument()
    await ridesShown()
    expect(calls).toContain('/commute/pickup-rides?pickup_point_id=1&from=08:00&to=08:30')
  })

  it('the summary’s two averages are the framed cells’ numbers per day, over all days and over Mondays (REQ-056, UD-25)', async () => {
    show()
    await ridesShown()
    const [from, to] = frame('ride')
    expect([from, to]).toEqual([3, 7])
    // Sum the numbers written in the framed columns, row by row, as a viewer would.
    const cells = rideCells()
    const perDay = Array.from({ length: 10 }, (_, d) => cells.slice(d * 12 + from, d * 12 + to).reduce((n, c) => n + Number(c.textContent || 0), 0))
    const daily = perDay.reduce((a, b) => a + b, 0) / 10
    const monday = (perDay[4] + perDay[9]) / 2
    expect(screen.getByText(/過去 10 個上班日/)).toHaveTextContent(
      `過去 10 個上班日，松山車站 07:45–08:45 平均每天載客 ${daily.toFixed(1)} 次；星期一平均 ${monday.toFixed(1)} 次。`,
    )
  })

  it('frames the chosen window with one frame on both grids, and bolds the dates on today’s weekday (UD-25)', async () => {
    show()
    await ridesShown()
    await screen.findByRole('group', { name: '內湖車流' })
    expect(frame('road')).toEqual(frame('ride'))
    for (const name of ['載客次數', '內湖車流'] as const) {
      const bold = [...grid(name).querySelectorAll('.font-bold')].map((el) => el.textContent)
      expect(bold).toEqual(['10/19 週一', '10/12 週一'])
    }
  })

  it('writes ride numbers, leaves 0 blank, and writes nothing in traffic cells (8.1, SC-X4)', async () => {
    show()
    await ridesShown()
    await screen.findByRole('group', { name: '內湖車流' })
    const first = rideCells()[0]
    expect(first).toHaveAccessibleName('10/23 週五 07:00–07:15 載客 0 次')
    expect(first).toHaveTextContent(/^$/)
    expect(rideCells()[1].textContent).toBe(String(rideCount(1, 0, 1)))
    expect(trafficCells().every((c) => c.textContent === '')).toBe(true)
  })

  it('the time window sheet offers 07:00–09:45 to start and 07:15–10:00 to end, end after start; the summary, rides and frames follow', async () => {
    const { calls } = show()
    await ridesShown()
    fireEvent.click(screen.getByRole('button', { name: /時段/ }))
    const sheet = screen.getByRole('dialog', { name: '選擇時段' })
    const starts = within(within(sheet).getByRole('radiogroup', { name: '開始' })).getAllByRole('radio')
    const ends = within(within(sheet).getByRole('radiogroup', { name: '結束' })).getAllByRole('radio')
    expect(starts.map((b) => b.textContent)).toEqual(SLOT_TIMES)
    expect(ends.map((b) => b.textContent)).toEqual([...SLOT_TIMES.slice(1), '10:00'])
    // Ends at or before the start cannot be chosen.
    expect(ends.filter((b) => (b as HTMLButtonElement).disabled).map((b) => b.textContent)).toEqual(['07:15', '07:30', '07:45'])

    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: '開始' })).getByRole('radio', { name: '09:00' }))
    expect(within(within(sheet).getByRole('radiogroup', { name: '結束' })).getByRole('radio', { name: '09:15', checked: true })).toBeInTheDocument()
    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: '結束' })).getByRole('radio', { name: '10:00' }))
    fireEvent.click(within(sheet).getByRole('button', { name: '看 09:00–10:00' }))

    expect(await screen.findByText(/松山車站 09:00–10:00 平均每天載客/)).toBeInTheDocument()
    expect(calls).toContain('/commute/pickup-rides?pickup_point_id=1&from=09:00&to=10:00')
    expect(frame('ride')).toEqual([8, 12])
    expect(frame('road')).toEqual([8, 12])
  })

  it('choosing another pickup point refreshes the summary and the rides grid (REQ-056)', async () => {
    const { calls } = show()
    await ridesShown()
    const before = rideCells()[1].textContent
    fireEvent.click(screen.getByRole('button', { name: /上車點\s*松山車站/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '選擇上車點' })).getByRole('radio', { name: '台北世貿中心' }))
    expect(await screen.findByText(/台北世貿中心 07:45–08:45 平均每天載客/)).toBeInTheDocument()
    expect(calls).toContain('/commute/pickup-rides?pickup_point_id=2&from=07:45&to=08:45')
    expect(rideCells()[1].textContent).toBe(String(rideCount(2, 0, 1)))
    expect(rideCells()[1].textContent).not.toBe(before)
  })

  it('opens on the given pickup point, the first one without', async () => {
    show({ pickupId: 2 })
    expect(await screen.findByRole('button', { name: /上車點\s*台北世貿中心/ })).toBeInTheDocument()
    show({ pickupId: null })
    expect(await screen.findByRole('button', { name: /上車點\s*松山車站/ })).toBeInTheDocument()
  })

  it('tapping a traffic cell shows its volume and average speed below the grid; again or elsewhere clears it (ui-oi-21)', async () => {
    show()
    await screen.findByRole('group', { name: '內湖車流' })
    const hint = '點一格看車流量與平均速度'
    expect(detailLine()).toBe(hint)

    // 10/22 08:15: the values of /api/commute/traffic, speed rounded.
    const cell = screen.getByRole('button', { name: '10/22 週四 08:15–08:30　車流 1,284 輛　平均 23 km/h' })
    fireEvent.click(cell)
    expect(detailLine()).toBe('10/22 週四 08:15–08:30　車流 1,284 輛　平均 23 km/h')
    expect(cell).toHaveAttribute('aria-pressed', 'true')
    // Choosing a cell leaves the window and the summary alone.
    expect(frame('road')).toEqual([3, 7])

    fireEvent.click(cell)
    expect(detailLine()).toBe(hint)

    // A slot no car passed: no average.
    fireEvent.click(screen.getByRole('button', { name: /^10\/12 週一 09:45–10:00/ }))
    expect(detailLine()).toMatch(/^10\/12 週一 09:45–10:00　車流 1,\d{3} 輛　平均 —$/)
    fireEvent.click(screen.getByRole('region', { name: '今天的天氣' }))
    expect(detailLine()).toBe(hint)

    // Changing the window clears it too.
    fireEvent.click(cell)
    fireEvent.click(screen.getByRole('button', { name: /時段/ }))
    fireEvent.click(screen.getByRole('button', { name: '看 07:45–08:45' }))
    expect(detailLine()).toBe(hint)
  })

  it('marks every simulated block: the weather and each grid’s title (REQ-063)', async () => {
    show()
    await ridesShown()
    await screen.findByRole('group', { name: '內湖車流' })
    expect(within(screen.getByRole('region', { name: '今天的天氣' })).getByText('模擬')).toBeInTheDocument()
    expect(screen.getAllByText('模擬')).toHaveLength(3)
  })

  it('uses the dark scales on asphalt and the light ones on white (8.1)', async () => {
    show({ ground: 'asphalt' })
    await ridesShown()
    await screen.findByRole('group', { name: '內湖車流' })
    expect(rideCells().some((c) => /\bbg-ride-dark-\d\b/.test(c.className))).toBe(true)
    expect(trafficCells().every((c) => /\bbg-road-dark-\d\b/.test(c.className))).toBe(true)
  })

  it('one API failing shows an error in that block only; the others stay (SC-X4)', async () => {
    show({ down: ['/commute/weather'] })
    expect(await screen.findByText('讀不到今天的天氣，其他資訊照常顯示')).toBeInTheDocument()
    // The traffic's now still gives the default window.
    await ridesShown()
    expect(screen.getByRole('button', { name: /時段\s*07:45–08:45/ })).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: '內湖車流' })).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('a failed rides or traffic call shows only its own error', async () => {
    show({ down: ['/commute/pickup-rides'] })
    expect(await screen.findByText('讀不到載客次數，請稍後再試')).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: '內湖車流' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '今天的天氣' })).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)

    show({ down: ['/commute/traffic'] })
    expect(await screen.findByText('讀不到車流，請稍後再試')).toBeInTheDocument()
  })

  it('a failed pickup point list shows an error in the rides block; weather and traffic stay (ui/CLAUDE.md 6)', async () => {
    show({ down: ['/pickup-points'] })
    expect(await screen.findByText('讀不到上車點，請稍後再試')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: '今天的天氣' })).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: '內湖車流' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '載客次數' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('when rides fail after a change, the rides grid keeps the last data framed on its own window, matching its summary', async () => {
    show({ ridesDownAfter: 1 })
    await ridesShown()
    fireEvent.click(screen.getByRole('button', { name: /時段/ }))
    const sheet = screen.getByRole('dialog', { name: '選擇時段' })
    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: '開始' })).getByRole('radio', { name: '09:00' }))
    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: '結束' })).getByRole('radio', { name: '10:00' }))
    fireEvent.click(within(sheet).getByRole('button', { name: '看 09:00–10:00' }))

    expect(await screen.findByText('讀不到載客次數，請稍後再試')).toBeInTheDocument()
    // The kept rides and their summary are for 07:45–08:45; their frame stays there, traffic moves.
    expect(screen.getByText(/松山車站 07:45–08:45 平均每天載客/)).toBeInTheDocument()
    expect(frame('ride')).toEqual([3, 7])
    expect(frame('road')).toEqual([8, 12])
  })

  it('the back button returns', async () => {
    const { onBack } = show()
    await ridesShown()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '返回' })))
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce())
  })
})
