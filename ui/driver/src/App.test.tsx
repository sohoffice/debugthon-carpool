import type { DriverRequestItem, DriverRequests, TripDefaults, TripView } from '@carpool/shared'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { POLL_INTERVAL_MS } from './config'

// A stand-in for Google Maps with a key set, so the test can see which markers and lines are drawn.
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: ReactNode }) => children,
  Map: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  AdvancedMarker: ({ title, children }: { title?: string; children: ReactNode }) => (
    <div role="img" aria-label={title}>
      {children}
    </div>
  ),
  Polyline: () => <div data-testid="route-line" />,
  useMap: () => null,
}))
vi.mock('../../shared/src/map/config', async (importOriginal) => ({ ...(await importOriginal<object>()), MAPS_API_KEY: 'test-key' }))

const PICKUP = { id: 1, name: '松山車站', lat: 25.0498, lng: 121.5782, radius_m: 80 }
const PICKUP_POINTS = [
  PICKUP,
  { id: 2, name: '台北世貿中心', lat: 25.03315, lng: 121.5619, radius_m: 80 },
  { id: 3, name: '台北大巨蛋', lat: 25.04387, lng: 121.5604, radius_m: 80 },
]
const DESTINATION = { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }
const ROUTE = { polyline: '', distance_m: 4400, duration_s: 1200, simulated: true, bus_stops: [{ id: 9, stop_id: 1116, name: '陽光街', lat: 0, lng: 0 }] }
const LAST_DEPARTURE: TripDefaults = { pickup_point_id: 1, destination: DESTINATION, capacity: 3, auto_accept: false, tag_filters: [] }
const NEVER_DEPARTED: TripDefaults = { pickup_point_id: null, destination: null, capacity: null, auto_accept: false, tag_filters: [] }
const NO_TRIP: DriverRequests = { trip_id: null, pending: [], passengers: [] }
const DRIVING: DriverRequests = { trip_id: 5, pending: [], passengers: [] }

function trip(change: Partial<TripView>): TripView {
  return {
    id: 5,
    driver_id: 6,
    status: 'active',
    pickup_point: PICKUP,
    destination: DESTINATION,
    capacity: 3,
    seats_held: 0,
    seats_confirmed: 0,
    seats_available: 3,
    auto_accept: false,
    settings_locked: true,
    passed_pickup: false,
    tag_filters: [],
    route: ROUTE,
    started_at: '2026-10-23T08:00:00Z',
    ...change,
  }
}

function request(change: Partial<DriverRequestItem>): DriverRequestItem {
  return {
    id: 7,
    status: 'waiting_driver',
    passenger_name: '乘客 小美',
    pickup_point: PICKUP,
    dropoff: { bus_stop_id: 9, name: '瑞光路', lat: 0, lng: 0 },
    relaxed: false,
    response_deadline_at: '2026-10-23T08:05:00Z',
    boarded: false,
    boarded_at: null,
    ...change,
  }
}

/**
 * Answers like the Go backend. `polls` are served in order for GET /driver/requests, the last one
 * repeats; accept and board move the request like the backend does.
 */
function fakeBackend(polls: DriverRequests[], { defaults = LAST_DEPARTURE, departStatus = 201 } = {}) {
  const calls: { method: string; path: string; body: unknown }[] = []
  let index = 0
  let state: DriverRequests | null = null
  // The caller's tag choice is kept like the backend keeps it (PUT/DELETE /api/me/tags/:id).
  let tagSelected = false
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace('/api', '')
    const method = init.method ?? 'GET'
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (path === '/driver/requests') return reply(state ?? polls[Math.min(index++, polls.length - 1)])
    if (path === '/driver/trips/defaults') return reply(defaults)
    if (path === '/trips/5') return reply(trip({ status: 'completed' }))
    if (path === '/pickup-points') return reply(PICKUP_POINTS)
    if (path === '/tags') return reply([{ id: 1, name: '不抽菸', issuer: 'self', selected: tagSelected }])
    if (path === '/me/tags/1' && (method === 'PUT' || method === 'DELETE')) {
      tagSelected = method === 'PUT'
      return new Response(null, { status: 204 })
    }
    if (path === '/driver/profile') return reply({ usual_pickup_point: null, usual_destination: null, capacity: null })
    if (path === '/driver/route-preview') return reply(ROUTE)
    if (path.startsWith('/places')) return reply([DESTINATION])
    if (method === 'POST' && path === '/driver/trips') {
      if (departStatus === 409) return reply({ error: { code: 'already_active', message: '駕駛已有進行中的行程' } }, 409)
      return reply(trip({}), 201)
    }
    if (method === 'POST' && path === '/driver/requests/7/accept') {
      state = { trip_id: 5, pending: [], passengers: [request({ status: 'confirmed', dropoff: { bus_stop_id: null, ...DESTINATION } })] }
      return reply({ id: 7, status: 'confirmed' })
    }
    if (method === 'POST' && path === '/driver/requests/7/board') {
      state = { trip_id: 5, pending: [], passengers: [request({ status: 'boarded', boarded: true, dropoff: { bus_stop_id: null, ...DESTINATION } })] }
      return reply({ id: 7, status: 'boarded' })
    }
    if (method === 'POST' && path === '/driver/requests/8/accept') return reply({ error: { code: 'not_waiting', message: '請求已不在等待駕駛回應' } }, 409)
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

const nextPoll = () => act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))

describe('driver App', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('prefills the last trip, so one tap departs with the same settings (REQ-016, REQ-017)', async () => {
    const calls = fakeBackend([NO_TRIP])
    render(<App />)

    expect(await screen.findByRole('heading', { name: '今天載人嗎？' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /目的地\s*瑞光路 513 巷/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '我出發了' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '我出發了' }))

    expect(await screen.findByRole('heading', { name: /目前沒有/ })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST' && c.path === '/driver/trips')?.body).toEqual({
      pickup_point_id: 1,
      destination: DESTINATION,
      capacity: 3,
      auto_accept: false,
      tag_filters: [],
    })
  })

  it('shows the 3 pickup points and the trip route on the map while choosing a pickup point (T14)', async () => {
    fakeBackend([NO_TRIP])
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /上車點\s*松山車站/ }))

    for (const p of PICKUP_POINTS) expect(await screen.findByRole('img', { name: p.name })).toBeInTheDocument()
    // One route: a white casing under the route colour (RoutePolyline).
    expect(screen.getAllByTestId('route-line')).toHaveLength(2)
  })

  it('keeps a chosen tag after a reload (T14)', async () => {
    fakeBackend([NO_TRIP])
    const first = render(<App />)
    await nextPoll()
    fireEvent.click(await screen.findByRole('button', { name: /我的標籤/ }))
    fireEvent.click(await within(await screen.findByRole('group', { name: '我的標籤' })).findByRole('button', { name: '不抽菸' }))
    await waitFor(() => expect(within(screen.getByRole('group', { name: '我的標籤' })).getByRole('button', { name: '不抽菸' })).toHaveAttribute('aria-pressed', 'true'))
    first.unmount()

    render(<App />)
    await nextPoll()
    fireEvent.click(await screen.findByRole('button', { name: /我的標籤/ }))
    await waitFor(() => expect(within(screen.getByRole('group', { name: '我的標籤' })).getByRole('button', { name: '不抽菸' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('cannot depart the first time until a destination is chosen', async () => {
    fakeBackend([NO_TRIP], { defaults: NEVER_DEPARTED })
    render(<App />)

    expect(await screen.findByRole('heading', { name: '第一次出發' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '我出發了' })).toBeDisabled()
    // The empty route strip says what is still to choose (8.6).
    expect(within(screen.getByRole('list', { name: '今天的路線' })).getByText('選目的地')).toBeInTheDocument()
  })

  it('a request turns the screen into the request view; confirming goes back to waiting', async () => {
    const calls = fakeBackend([{ trip_id: 5, pending: [request({})], passengers: [] }])
    render(<App />)

    expect(await screen.findByRole('heading', { name: '有乘客要搭車' })).toBeInTheDocument()
    expect(screen.getByText('瑞光路')).toBeInTheDocument()
    expect(screen.queryByText(/地圖/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '確認' }))

    const passengers = await screen.findByRole('region', { name: '乘客' })
    fireEvent.click(within(passengers).getByRole('button', { name: '瑞光路 513 巷的乘客已上車' }))
    expect(await within(passengers).findByRole('button', { name: '瑞光路 513 巷的乘客已下車' })).toBeInTheDocument()
    expect(calls.map((c) => c.path)).toEqual(expect.arrayContaining(['/driver/requests/7/accept', '/driver/requests/7/board']))
  })

  it('a request answered elsewhere (409 not_waiting) just shows the current state', async () => {
    fakeBackend([{ trip_id: 5, pending: [request({ id: 8 })], passengers: [] }, DRIVING])
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '確認' }))
    expect(await screen.findByRole('heading', { name: /目前沒有/ })).toBeInTheDocument()
  })

  it('shows the running trip when it was already started elsewhere (409 already_active)', async () => {
    fakeBackend([NO_TRIP, DRIVING], { departStatus: 409 })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: '我出發了' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '我出發了' }))
    expect(await screen.findByRole('heading', { name: /目前沒有/ })).toBeInTheDocument()
  })

  it('says the backend lacks the trip API instead of "cannot connect" on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'not_found', message: '找不到這個 API' } }), { status: 404 })))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('後端還沒有提供行程查詢（找不到這個 API）')
  })

  it('has no debug mode without ?debug=1 (DD-14)', async () => {
    fakeBackend([NO_TRIP], { defaults: NEVER_DEPARTED })
    render(<App />)
    await screen.findByRole('heading', { name: '第一次出發' })
    expect(screen.queryByRole('button', { name: '除錯' })).not.toBeInTheDocument()
  })

  it('shows the arrival screen when the running trip ends by itself (UD-16)', async () => {
    fakeBackend([DRIVING, NO_TRIP])
    render(<App />)
    await screen.findByRole('heading', { name: /目前沒有/ })

    await nextPoll()
    expect(await screen.findByRole('heading', { name: '已到達目的地' })).toBeInTheDocument()
    expect(screen.getByText('瑞光路 513 巷')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '好' }))
    expect(await screen.findByRole('heading', { name: '今天載人嗎？' })).toBeInTheDocument()
  })
})
