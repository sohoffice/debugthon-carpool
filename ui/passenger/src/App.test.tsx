import type { PassengerProfile, RequestStatusView, Supply, TripView } from '@carpool/shared'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { POLL_INTERVAL_MS } from './config'

const SONGSHAN = { id: 1, name: '松山車站', lat: 25.049806, lng: 121.578206, radius_m: 80 }
const WTC = { id: 2, name: '台北世貿中心', lat: 25.03315, lng: 121.5619, radius_m: 80 }
const DESTINATION = { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }
const STOP = { id: 9, stop_id: 1013, name: '瑞光港墘路口', lat: 25.077753, lng: 121.571868 }
const PROFILE: PassengerProfile = { usual_arrival_time: '08:15', usual_destination: DESTINATION, accepted_stops: [STOP] }
const NO_PROFILE: PassengerProfile = { usual_arrival_time: null, usual_destination: null, accepted_stops: [] }
const ROUTE = { polyline: '', distance_m: 4000, duration_s: 900, simulated: true, bus_stops: [STOP] }
const VEHICLE = { plate: 'DEF-4567', description: '藍色 Mazda 3' }

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
}

function supply(pickup = SONGSHAN): Supply {
  return {
    pickup_point: pickup,
    destination: DESTINATION,
    accepted_stop_ids: [STOP.id],
    card: { count: 3, fastest_eta_s: 170, seats_remaining: 6 },
    timeline_range_s: 600,
    cars: [170, 350, 520].map((eta_s, i) => ({ trip_id: i + 1, eta_s, seats_available: 2 })),
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
    trip: null,
    ...change,
  }
}

const CONFIRMED = request({ status: 'confirmed', pickup_point: SONGSHAN, vehicle: VEHICLE, eta_s: 170, trip: TRIP })
const BOARDED = request({ status: 'boarded' })
const COMPLETED = request({ status: 'completed' })

interface Backend {
  profile?: PassengerProfile
  /** Served in order for GET /passenger/requests/current; the last one repeats. */
  current?: (RequestStatusView | null)[]
  /** Served in order for GET /passenger/requests/7; the last one repeats. An action moves on to its own. */
  statuses?: RequestStatusView[]
  actions?: Record<string, RequestStatusView>
}

function fakeBackend({ profile = PROFILE, current = [null], statuses = [request({})], actions = {} }: Backend) {
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
      if (pathname === '/passenger/profile') return reply(profile)
      if (pathname === '/passenger/requests/current') return reply({ request: current[Math.min(currentIndex++, current.length - 1)] })
      if (pathname === '/passenger/requests/7') return reply(acted ?? statuses[Math.min(statusIndex++, statuses.length - 1)])
      if (pathname === '/trips/4') return reply(TRIP)
      if (pathname === '/passenger/supply') return reply(supply(new URLSearchParams(path.split('?')[1]).get('pickup_point_id') === '2' ? WTC : SONGSHAN))
      if (pathname === '/places') return reply([DESTINATION])
      if (method === 'POST' && pathname === '/activities') return reply({ id: 1, role: 'passenger', trip_id: null, created_at: '' }, 201)
      if (method === 'POST' && pathname === '/location') return reply({}, 201)
      if (method === 'POST' && pathname === '/passenger/requests') {
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
    expect(screen.getByText('接近中的車：3、6、9 分鐘後到')).toBeInTheDocument()
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
    expect(screen.getByText('DEF-4567 3 分鐘後到松山車站')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '我已上車' }))
    expect(await screen.findByRole('heading', { name: `在${STOP.name}下車` })).toBeInTheDocument()
    expect(screen.queryByText('分鐘後到')).not.toBeInTheDocument()
    // The status no longer carries the car after boarding (DD-27); the screen kept it.
    expect(screen.getByText('DEF-4567')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '我已下車，結束共乘' }))
    expect(await screen.findByRole('heading', { name: '共乘完成' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '回到首頁' }))
    expect(await screen.findByRole('button', { name: '今天我要搭' })).toBeInTheDocument()
  })

  it('no car: says so at once, without alternatives (REQ-036; REQ-051 not in the PoC)', async () => {
    fakeBackend({ statuses: [request({ status: 'no_match', reason: 'no_match', message: '目前沒有可搭的車', trip_id: null })] })
    render(<App />)
    await sendRequest()

    expect(await screen.findByRole('heading', { name: '目前沒有可搭的車' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '替代方案' })).not.toBeInTheDocument()
  })

  it('too far: shows the backend’s message (REQ-034, SC-P8)', async () => {
    const message = '你離上車點「松山車站」約 420 公尺，超過送出請求距離 200 公尺'
    fakeBackend({ statuses: [request({ status: 'rejected', reason: 'too_far', message, trip_id: null })] })
    render(<App />)
    await sendRequest()
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('a driver timing out shows the request was reassigned (REQ-053)', async () => {
    fakeBackend({ statuses: [request({}), request({ reassigned_count: 1 })] })
    render(<App />)
    await sendRequest()
    expect(await screen.findByText('上一位駕駛沒有回應，已改配下一台車。')).toBeInTheDocument()
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
    fireEvent.click(await screen.findByRole('button', { name: DESTINATION.name }))
    fireEvent.click(await screen.findByRole('button', { name: STOP.name }))
    fireEvent.click(screen.getByRole('button', { name: '查看接近的車' }))
    expect(await screen.findByText('到 瑞光路 513 巷')).toBeInTheDocument()
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

  it('has no debug mode without ?debug=1 (DD-26)', async () => {
    fakeBackend({})
    render(<App />)
    await screen.findByText('到 瑞光路 513 巷')
    expect(screen.queryByRole('button', { name: '除錯' })).not.toBeInTheDocument()
  })
})
