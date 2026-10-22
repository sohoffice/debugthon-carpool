import type { PassengerProfile, RequestStatusView, Supply, TripView } from '@carpool/shared'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { POLL_INTERVAL_MS } from './config'

// Google Places is never called in tests (DD-32): one place in the park and one outside for any query.
vi.mock('../../shared/src/map/usePlaceSearch', () => {
  const found = [
    { id: 'in', name: '瑞光路 513 巷', detail: '內湖區', resolve: async () => ({ name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }) },
    { id: 'out', name: '台北 101', detail: '信義區', resolve: async () => ({ name: '台北 101', lat: 25.0339, lng: 121.5645 }) },
  ]
  const searcher = { suggest: async () => found }
  return { usePlaceSearch: () => searcher }
})

const SONGSHAN = { id: 1, name: '松山車站', lat: 25.049806, lng: 121.578206, radius_m: 80 }
const WTC = { id: 2, name: '台北世貿中心', lat: 25.03315, lng: 121.5619, radius_m: 80 }
const DESTINATION = { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }
const STOP = { id: 9, stop_id: 1013, name: '瑞光港墘路口', lat: 25.077753, lng: 121.571868 }
const PROFILE: PassengerProfile = { usual_arrival_time: '08:15', usual_destination: DESTINATION, accepted_stops: [STOP] }
const NO_PROFILE: PassengerProfile = { usual_arrival_time: null, usual_destination: null, accepted_stops: [] }
const ROUTE = { polyline: '', distance_m: 4000, duration_s: 900, simulated: true, bus_stops: [STOP] }
const VEHICLE = { plate: 'ABC-0004', description: '藍色 Mazda 3' }

const TRIP: TripView = {
  id: 4,
  driver_id: 6,
  status: 'active',
  pickup_point: SONGSHAN,
  destination: DESTINATION,
  capacity: 3,
  seats_held: 0,
  seats_confirmed: 1,
  seats_available: 2,
  auto_accept: false,
  settings_locked: true,
  passed_pickup: false,
  tag_filters: [],
  route: ROUTE,
  started_at: '2026-10-24T00:08:00Z',
  ended_at: null,
  completed_rides: 0,
}

/** Three cars; only the second one's ETA is simulated unless `simulated` says which (REQ-063). */
function supply(pickup = SONGSHAN, simulated = [false, true, false]): Supply {
  return {
    pickup_point: pickup,
    destination: DESTINATION,
    accepted_stop_ids: [STOP.id],
    card: { count: 3, fastest_eta_s: 170, fastest_eta_simulated: simulated[0], seats_remaining: 6 },
    timeline_range_s: 600,
    cars: [170, 350, 520].map((eta_s, i) => ({ trip_id: i + 1, eta_s, eta_simulated: simulated[i], seats_available: 2 })),
  }
}

/** A request status like the Go backend's GET /passenger/requests/:id. */
function request(change: Partial<RequestStatusView>): RequestStatusView {
  return {
    id: 7,
    status: 'waiting_driver',
    reason: null,
    message: null,
    relaxed: false,
    pickup_point_id: 1,
    submitted_lat: 25.05,
    submitted_lng: 121.578206,
    trip_id: 4,
    dropoff_bus_stop_id: STOP.id,
    response_deadline_at: '2026-10-24T00:13:00Z',
    confirmed_at: null,
    boarded_at: null,
    completed_at: null,
    created_at: '2026-10-24T00:12:00Z',
    reassigned_count: 0,
    pickup_point: null,
    vehicle: null,
    eta_s: null,
    eta_simulated: null,
    trip: null,
    vehicle_position: null,
    passed_pickup: null,
    ...change,
  }
}

const CONFIRMED = request({
  status: 'confirmed',
  pickup_point: SONGSHAN,
  vehicle: VEHICLE,
  eta_s: 170,
  eta_simulated: false,
  trip: TRIP,
  vehicle_position: { lat: 25.046, lng: 121.578, heading_deg: 5.2, reported_at: '2026-10-24T00:12:30Z' },
  passed_pickup: false,
})
const BOARDED = request({ status: 'boarded' })
const COMPLETED = request({ status: 'completed' })

interface Backend {
  /** Served in order for GET /passenger/profile; the last one repeats. */
  profile?: PassengerProfile | PassengerProfile[]
  /** Which cars' ETAs are simulated, in ETA order. */
  simulated?: boolean[]
  /** Answer POST /passenger/requests with 400 destination_outside_park. */
  outsidePark?: boolean
  /** Served in order for GET /passenger/requests/current; the last one repeats. */
  current?: (RequestStatusView | null)[]
  /** Served in order for GET /passenger/requests/7; the last one repeats. An action moves on to its own. */
  statuses?: RequestStatusView[]
  actions?: Record<string, RequestStatusView>
}

function fakeBackend({ profile = PROFILE, simulated, outsidePark = false, current = [null], statuses = [request({})], actions = {} }: Backend) {
  const profiles = Array.isArray(profile) ? profile : [profile]
  let profileIndex = 0
  const calls: { method: string; path: string; body: unknown }[] = []
  let currentIndex = 0
  let statusIndex = 0
  let acted: RequestStatusView | null = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace('/api', '')
      const method = init.method ?? 'GET'
      calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined })
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      const pathname = path.split('?')[0]
      if (pathname === '/pickup-points') return reply([SONGSHAN, WTC])
      if (pathname === '/bus-stops') return reply([STOP])
      if (pathname === '/tags') return reply([{ id: 1, name: '不抽菸', issuer: 'self', selected: false }])
      if (pathname === '/passenger/profile') return reply(profiles[Math.min(profileIndex++, profiles.length - 1)])
      if (pathname === '/passenger/requests/current') return reply({ request: current[Math.min(currentIndex++, current.length - 1)] })
      if (pathname === '/passenger/requests/7') return reply(acted ?? statuses[Math.min(statusIndex++, statuses.length - 1)])
      if (pathname === '/trips/4') return reply(TRIP)
      if (pathname === '/passenger/supply') return reply(supply(new URLSearchParams(path.split('?')[1]).get('pickup_point_id') === '2' ? WTC : SONGSHAN, simulated))
      // Like the backend's park boundary: north of the pickup points.
      if (pathname === '/park/check') return reply({ inside: Number(new URLSearchParams(path.split('?')[1]).get('lat')) > 25.05 })
      if (method === 'POST' && pathname === '/activities') return reply({ id: 1, role: 'passenger', trip_id: null, created_at: '' }, 201)
      if (method === 'POST' && pathname === '/location') return reply({}, 201)
      if (method === 'POST' && pathname === '/passenger/requests') {
        if (outsidePark) return reply({ error: { code: 'destination_outside_park', message: '最終目的地必須在內湖科學園區內' } }, 400)
        const { reassigned_count: _, pickup_point: __, vehicle: ___, eta_s: ____, trip: _____, ...view } = statuses[0]
        return reply(view, 201)
      }
      const action = Object.keys(actions).find((a) => method === 'POST' && pathname === `/passenger/requests/7/${a}`)
      if (action) {
        acted = actions[action]
        return reply({ id: 7, status: acted.status })
      }
      return reply({ error: { code: 'not_found', message: 'not found' } }, 404)
    }),
  )
  return calls
}

const nextPoll = () => act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))

async function sendRequest() {
  fireEvent.click(await screen.findByRole('button', { name: '今天我要搭' }))
  fireEvent.click(screen.getByRole('button', { name: '送出請求' }))
}

describe('passenger App', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('opens on the nearest pickup point’s board with habitual data, and can switch pickup point (REQ-025, REQ-029)', async () => {
    const calls = fakeBackend({})
    render(<App />)

    expect(await screen.findByText('到 瑞光路 513 巷')).toBeInTheDocument()
    expect(await screen.findByText('3 台車接近中')).toBeInTheDocument()
    expect(screen.getByText('接近中的車：3、6（估算）、9 分鐘後到')).toBeInTheDocument()
    expect(screen.getByText('空位 6')).toBeInTheDocument()
    // T11 query: destination, stops and filters (types.ts Supply).
    expect(calls.find((c) => c.path.startsWith('/passenger/supply'))?.path).toMatch(/pickup_point_id=1&dest_name=.+&dest_lat=25.0765&dest_lng=121.5742&stop_ids=9&required_tags=&preferred_tags=$/)

    fireEvent.click(screen.getByRole('button', { name: /台北世貿中心/ }))
    expect(await screen.findByRole('region', { name: '台北世貿中心的接近車輛' })).toBeInTheDocument()
    expect(screen.getByText(/距離 .*公里/)).toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.path.includes('pickup_point_id=2'))).toBe(true))
    // Far away still sends: the backend checks the distance (SC-P2, SC-P8).
    expect(screen.getByRole('button', { name: '今天我要搭' })).toBeEnabled()
    expect(screen.queryByText('走到上車點附近才能送出')).not.toBeInTheDocument()
  })

  it('full ride: supply → request → confirmed → boarded → completed (T16)', async () => {
    const calls = fakeBackend({ statuses: [request({}), request({}), CONFIRMED], actions: { board: BOARDED, complete: COMPLETED } })
    render(<App />)
    await sendRequest()

    expect(await screen.findByRole('heading', { name: '正在等駕駛確認' })).toBeInTheDocument()
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.path)
    // Take part first, then send with the position; the position is reported too (DD-25).
    expect(posts.indexOf('/activities')).toBeLessThan(posts.indexOf('/passenger/requests'))
    expect(posts).toContain('/location')
    expect(calls.find((c) => c.path === '/passenger/requests')?.body).toMatchObject({
      pickup_point_id: 1,
      destination: DESTINATION,
      stop_ids: [9],
      tag_filters: [],
      location: { lat: expect.closeTo(25.05003, 4), lng: SONGSHAN.lng },
    })

    await nextPoll()
    expect(await screen.findByText('配到車了')).toBeInTheDocument()
    expect(screen.getByText('分鐘後到')).toBeInTheDocument()
    expect(screen.getByText('ABC-0004 3 分鐘後到松山車站')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '我已上車' }))
    expect(await screen.findByRole('heading', { name: `在${STOP.name}下車` })).toBeInTheDocument()
    expect(screen.queryByText('分鐘後到')).not.toBeInTheDocument()
    // The status no longer carries the car after boarding (DD-27); the screen kept it.
    expect(screen.getByText('ABC-0004')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '我已下車，結束共乘' }))
    expect(await screen.findByRole('heading', { name: '共乘完成' })).toBeInTheDocument()
    // SC-P9: the ride's pickup, drop-off and car; no time in the car without a boarding time.
    const ride = screen.getByRole('list', { name: '這趟共乘' })
    expect(within(ride).getByText(SONGSHAN.name)).toBeInTheDocument()
    expect(within(ride).getByText(STOP.name)).toBeInTheDocument()
    expect(screen.getByText('ABC-0004')).toBeInTheDocument()
    expect(screen.queryByText(/車上 \d+ 分鐘/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '回到首頁' }))
    expect(await screen.findByRole('button', { name: '今天我要搭' })).toBeInTheDocument()
  })

  it('marks only simulated ETAs on the board (REQ-063)', async () => {
    fakeBackend({ simulated: [true, false, false] })
    render(<App />)
    const heading = await screen.findByRole('heading', { name: /最快/ })
    expect(heading).toHaveTextContent('估算')
    expect(screen.getByText('接近中的車：3（估算）、6、9 分鐘後到')).toBeInTheDocument()
  })

  it('a real fastest ETA is not marked (REQ-063)', async () => {
    fakeBackend({ simulated: [false, false, false] })
    render(<App />)
    const heading = await screen.findByRole('heading', { name: /最快/ })
    expect(heading).not.toHaveTextContent('估算')
    expect(screen.getByText('接近中的車：3、6、9 分鐘後到')).toBeInTheDocument()
  })

  it('confirmed: a simulated ETA is marked, and a car past the pickup says it is there (REQ-063, DD-31)', async () => {
    const simulated = { ...CONFIRMED, eta_simulated: true }
    const passed = { ...CONFIRMED, eta_s: null, eta_simulated: null, passed_pickup: true }
    fakeBackend({ current: [simulated], statuses: [simulated, passed] })
    render(<App />)
    expect(await screen.findByRole('heading', { name: /分鐘後到/ })).toHaveTextContent('估算')
    await nextPoll()
    expect(await screen.findByRole('heading', { name: '車已到上車點' })).toBeInTheDocument()
  })

  it('a destination outside the park is refused with a short message and no request (REQ-001)', async () => {
    const calls = fakeBackend({ outsidePark: true })
    render(<App />)
    await sendRequest()
    expect(await screen.findByText('目的地不在內湖科學園區內，請先修改目的地。')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '送出搭車請求' })).toBeInTheDocument()
    // The status of a created request is never asked for.
    expect(calls.some((c) => c.path === '/passenger/requests/7')).toBe(false)
  })

  it('no car: says so at once, without alternatives (REQ-036; REQ-051 not in the PoC)', async () => {
    fakeBackend({ statuses: [request({ status: 'no_match', reason: 'no_match', message: '目前沒有可搭的車', trip_id: null })] })
    render(<App />)
    await sendRequest()

    expect(await screen.findByRole('heading', { name: '目前沒有可搭的車' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '替代方案' })).not.toBeInTheDocument()
  })

  it('completed: shows the minutes in the car from boarded_at to completed_at, never a clock time (SC-P9)', async () => {
    const done = request({ status: 'completed', boarded_at: '2026-10-24T08:31:00Z', completed_at: '2026-10-24T08:45:20Z' })
    fakeBackend({ current: [BOARDED], statuses: [BOARDED], actions: { complete: done } })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '我已下車，結束共乘' }))
    expect(await screen.findByText('車上 14 分鐘')).toBeInTheDocument()
    expect(screen.queryByText(/08:45|16:45/)).not.toBeInTheDocument()
  })

  it('too far: shows the backend’s message (REQ-034, SC-P8)', async () => {
    const message = '你離上車點「松山車站」約 420 公尺，超過送出請求距離 200 公尺'
    fakeBackend({ statuses: [request({ status: 'rejected', reason: 'too_far', message, trip_id: null })] })
    render(<App />)
    await sendRequest()
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '還不能送出' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '回去看接近的車' }))
    expect(await screen.findByRole('button', { name: '今天我要搭' })).toBeInTheDocument()
  })

  it('a driver declining or timing out shows the request was reassigned (REQ-053)', async () => {
    fakeBackend({ statuses: [request({}), request({ reassigned_count: 1 })] })
    render(<App />)
    await sendRequest()
    expect(await screen.findByText('上一位駕駛無法載你，已改配下一台車。')).toBeInTheDocument()
  })

  it('does not claim why it was reassigned: the status only has a count (REQ-053)', async () => {
    fakeBackend({ statuses: [request({}), request({ reassigned_count: 2 })] })
    render(<App />)
    await sendRequest()
    await screen.findByText(/已改配下一台車/)
    // reassigned_count does not say whether the driver declined or timed out.
    expect(screen.queryByText(/沒有回應|婉拒|逾時/)).not.toBeInTheDocument()
  })

  it('"取消請求" is only a placeholder: it calls no API and the request stays (UD-17)', async () => {
    const calls = fakeBackend({})
    render(<App />)
    await sendRequest()
    await screen.findByRole('heading', { name: '正在等駕駛確認' })
    const before = calls.filter((c) => c.method === 'POST').length

    fireEvent.click(screen.getByRole('button', { name: '取消請求' }))
    await nextPoll()
    expect(screen.getByRole('heading', { name: '正在等駕駛確認' })).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(before)
  })

  it('does not send a second request while one is open (REQ-069)', async () => {
    const calls = fakeBackend({ current: [null, request({})] })
    render(<App />)
    await sendRequest()
    expect(await screen.findByRole('heading', { name: '正在等駕駛確認' })).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/passenger/requests')).toBe(false)
  })

  it('comes back to the open request after a reload', async () => {
    fakeBackend({ current: [CONFIRMED], statuses: [CONFIRMED] })
    render(<App />)
    expect(await screen.findByRole('button', { name: '我已上車' })).toBeInTheDocument()
    expect(screen.queryByText('配到車了')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '今天我要搭' })).not.toBeInTheDocument()
  })

  it('boarded: the route starts at the passenger’s stop, without the pickup point (SC-P6, REQ-068)', async () => {
    fakeBackend({ current: [BOARDED], statuses: [BOARDED] })
    render(<App />)
    const route = await screen.findByRole('list', { name: '這趟的路線' })
    await waitFor(() => expect(within(route).getAllByRole('listitem')).toHaveLength(2))
    const rows = within(route).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent(`${STOP.name}下車`)
    expect(rows[1]).toHaveTextContent(`${DESTINATION.name}終點`)
    expect(within(route).queryByText(SONGSHAN.name)).not.toBeInTheDocument()
  })

  it('boarded at the driver’s destination: one row, marked 下車 (SC-P6)', async () => {
    const atDestination = request({ status: 'boarded', dropoff_bus_stop_id: null })
    fakeBackend({ current: [atDestination], statuses: [atDestination] })
    render(<App />)
    expect(await screen.findByRole('heading', { name: `在${DESTINATION.name}下車` })).toBeInTheDocument()
    const route = await screen.findByRole('list', { name: '這趟的路線' })
    const rows = within(route).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent(`${DESTINATION.name}下車`)
    expect(within(route).queryByText('終點')).not.toBeInTheDocument()
  })

  it('boarded after a reload: the route comes from the trip', async () => {
    const calls = fakeBackend({ current: [BOARDED], statuses: [BOARDED] })
    render(<App />)
    expect(await screen.findByRole('heading', { name: `在${STOP.name}下車` })).toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.path === '/trips/4')).toBe(true))
    expect(await screen.findByRole('list', { name: '這趟的路線' })).toBeInTheDocument()
  })

  it('comes back to the open request after a reload even without habitual data', async () => {
    fakeBackend({ profile: NO_PROFILE, current: [CONFIRMED], statuses: [CONFIRMED] })
    render(<App />)
    expect(await screen.findByRole('button', { name: '我已上車' })).toBeInTheDocument()
  })

  it('without habitual data starts at the destination setup, which needs a destination and a stop', async () => {
    fakeBackend({ profile: NO_PROFILE })
    render(<App />)

    expect(await screen.findByRole('heading', { name: '要去內科哪裡？' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看接近的車' })).toBeDisabled()
    expect(screen.queryByRole('img', { name: 'Google Maps' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '目的地地址' }), { target: { value: '瑞光' } })
    // Places suggestions on a screen without a map carry the Google Maps logo (attribution policy).
    expect(await screen.findByRole('img', { name: 'Google Maps' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(DESTINATION.name) }))
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Google Maps' })).not.toBeInTheDocument())
    fireEvent.click(await screen.findByRole('button', { name: STOP.name }))
    fireEvent.click(screen.getByRole('button', { name: '查看接近的車' }))
    expect(await screen.findByText('到 瑞光路 513 巷')).toBeInTheDocument()
  })

  it('a destination outside the park is flagged at once and not taken (DD-32, REQ-001)', async () => {
    fakeBackend({ profile: NO_PROFILE })
    render(<App />)
    await screen.findByRole('heading', { name: '要去內科哪裡？' })
    fireEvent.change(screen.getByRole('searchbox', { name: '目的地地址' }), { target: { value: '101' } })
    fireEvent.click(await screen.findByRole('button', { name: /台北 101/ }))

    expect(await screen.findByText('台北 101不在內湖科學園區內，請換一個地點。')).toBeInTheDocument()
    expect(screen.getByText('先填目的地，這裡會列出附近的公車站。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看接近的車' })).toBeDisabled()
  })

  it('habitual destination without stops is prefilled; the setup asks for a stop (REQ-025, DD-19)', async () => {
    fakeBackend({ profile: { ...PROFILE, accepted_stops: [] } })
    render(<App />)
    expect(await screen.findByRole('heading', { name: '要去內科哪裡？' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: '目的地地址' })).toHaveValue(DESTINATION.name)
    expect(screen.getByRole('button', { name: '查看接近的車' })).toBeDisabled()
    fireEvent.click(await screen.findByRole('button', { name: STOP.name }))
    fireEvent.click(screen.getByRole('button', { name: '查看接近的車' }))
    expect(await screen.findByText(`到 ${DESTINATION.name}`)).toBeInTheDocument()
  })

  it('reloaded mid-ride without habitual data: back home uses what the finished ride left (REQ-025, DD-19)', async () => {
    fakeBackend({ profile: [NO_PROFILE, { ...PROFILE, accepted_stops: [] }], current: [BOARDED], statuses: [BOARDED], actions: { complete: COMPLETED } })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '我已下車，結束共乘' }))
    fireEvent.click(await screen.findByRole('button', { name: '回到首頁' }))
    expect(await screen.findByRole('heading', { name: '要去內科哪裡？' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('searchbox', { name: '目的地地址' })).toHaveValue(DESTINATION.name))
  })

  it('remembers the filters in this browser for next time (7.1)', async () => {
    fakeBackend({})
    const first = render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '今天我要搭' }))
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '不抽菸的篩選' })).getByRole('radio', { name: '強制' }))
    fireEvent.click(screen.getByRole('button', { name: '送出請求' }))
    await screen.findByRole('heading', { name: '正在等駕駛確認' })
    first.unmount()

    const calls = fakeBackend({})
    render(<App />)
    await screen.findByText('3 台車接近中')
    expect(calls.find((c) => c.path.startsWith('/passenger/supply'))?.path).toContain('required_tags=1')
  })

  it('the destination setup lists 同企業 above the filters, selected, simulated and not tappable (REQ-062, REQ-063, DD-43)', async () => {
    const calls = fakeBackend({ profile: NO_PROFILE })
    render(<App />)
    await screen.findByRole('heading', { name: '要去內科哪裡？' })
    const chip = screen.getByText('同企業')
    expect(chip.closest('p')).toHaveTextContent('模擬')
    // Apart from the operable filters, with no 強制 or 建議 of its own.
    expect(screen.queryByRole('radiogroup', { name: /同企業/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /同企業/ })).not.toBeInTheDocument()
    expect(chip.compareDocumentPosition(screen.getByRole('radiogroup', { name: '不抽菸的篩選' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const before = calls.length
    fireEvent.click(chip)
    expect(calls.slice(before).filter((c) => c.method !== 'GET')).toEqual([])
    expect(screen.getByText('同企業')).toBeInTheDocument()
  })

  it('同企業 in the send sheet is never sent: not in the request nor in the supply query (REQ-062, DD-43)', async () => {
    const calls = fakeBackend({})
    render(<App />)
    await screen.findByText('3 台車接近中')
    fireEvent.click(await screen.findByRole('button', { name: '今天我要搭' }))
    const sheet = screen.getByRole('dialog', { name: '送出搭車請求' })
    const chip = within(sheet).getByText('同企業')
    expect(chip.closest('p')).toHaveTextContent('模擬')
    expect(within(sheet).queryByRole('radiogroup', { name: /同企業/ })).not.toBeInTheDocument()
    fireEvent.click(chip)
    expect(screen.getByRole('dialog', { name: '送出搭車請求' })).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('radio', { name: '建議' }))
    fireEvent.click(screen.getByRole('button', { name: '送出請求' }))
    await screen.findByRole('heading', { name: '正在等駕駛確認' })

    // Only the operable filter goes out; the simulated company never does.
    expect(calls.find((c) => c.path === '/passenger/requests')?.body).toMatchObject({ tag_filters: [{ tag_id: 1, intent: 'preferred' }] })
    const supplyQueries = calls.filter((c) => c.path.startsWith('/passenger/supply')).map((c) => c.path)
    expect(supplyQueries.length).toBeGreaterThan(0)
    for (const q of supplyQueries) expect(decodeURIComponent(q)).not.toMatch(/同企業|內科示範科技|company/)
    expect(JSON.stringify(calls.map((c) => c.body))).not.toMatch(/同企業|內科示範科技/)
  })

  it('confirmed: says the driver is from the same simulated company (REQ-062, REQ-063)', async () => {
    fakeBackend({ current: [CONFIRMED], statuses: [CONFIRMED] })
    render(<App />)
    const line = await screen.findByText(/駕駛與你同企業：內科示範科技/)
    expect(line).toHaveTextContent('模擬')
  })

  it('has no debug mode without ?debug=1 (DD-26)', async () => {
    fakeBackend({})
    render(<App />)
    await screen.findByText('到 瑞光路 513 巷')
    expect(screen.queryByRole('button', { name: '除錯' })).not.toBeInTheDocument()
  })
})
