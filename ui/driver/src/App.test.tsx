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
// Google Places is never called in tests (DD-32): a fake that finds one place in the park and one
// outside, or nothing at all when Places is down.
const places = vi.hoisted(() => {
  const found = [
    { id: 'in', name: '瑞光路 513 巷', detail: '內湖區', resolve: async () => ({ name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }) },
    { id: 'out', name: '台北 101', detail: '信義區', resolve: async () => ({ name: '台北 101', lat: 25.0339, lng: 121.5645 }) },
  ]
  const searcher = { suggest: async () => found }
  return { available: true, searcher }
})
vi.mock('../../shared/src/map/usePlaceSearch', () => ({ usePlaceSearch: () => (places.available ? places.searcher : null) }))

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
    ended_at: null,
    completed_rides: 0,
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
function fakeBackend(
  polls: DriverRequests[],
  {
    defaults = LAST_DEPARTURE,
    departStatus = 201,
    route = ROUTE,
    ended = trip({ status: 'completed', completed_rides: 2 }),
    refusedPreviews = [] as number[],
    autoAccept = false,
  } = {},
) {
  const calls: { method: string; path: string; body: unknown }[] = []
  // Each preview is saved with a new id (T26); refusedPreviews are the ids a departure turns down.
  let previews = 0
  let index = 0
  let state: DriverRequests | null = null
  let polled: DriverRequests | undefined
  // The caller's tag choice is kept like the backend keeps it (PUT/DELETE /api/me/tags/:id).
  let tagSelected = false
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace('/api', '')
    const method = init.method ?? 'GET'
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (path === '/driver/requests') return reply((polled = state ?? polls[Math.min(index++, polls.length - 1)]))
    if (path === '/driver/trips/defaults') return reply(defaults)
    // Trip 5 while it runs, or how it ended once the driver's poll no longer has it.
    if (path === '/trips/5') return reply(polled?.trip_id === 5 ? trip({ auto_accept: autoAccept }) : ended)
    if (path === '/pickup-points') return reply(PICKUP_POINTS)
    if (path === '/tags') return reply([{ id: 1, name: '不抽菸', issuer: 'self', selected: tagSelected }])
    if (path === '/me/tags/1' && (method === 'PUT' || method === 'DELETE')) {
      tagSelected = method === 'PUT'
      return new Response(null, { status: 204 })
    }
    if (path === '/driver/profile') return reply({ usual_pickup_point: null, usual_destination: null, capacity: null })
    // Like the backend's park boundary: north of the pickup points.
    if (path.startsWith('/park/check')) return reply({ inside: Number(new URLSearchParams(path.split('?')[1]).get('lat')) > 25.05 })
    if (path === '/driver/route-preview') return reply({ preview_id: ++previews, route })
    if (method === 'POST' && path === '/driver/trips') {
      const previewId = (calls.at(-1)!.body as { preview_id?: number }).preview_id
      if (previewId !== undefined && refusedPreviews.includes(previewId)) {
        return reply({ error: { code: 'invalid_route_preview', message: '路線預覽不存在、已使用，或與出發的上車點、目的地不符，請重新預覽' } }, 400)
      }
      if (departStatus === 409) return reply({ error: { code: 'already_active', message: '駕駛已有進行中的行程' } }, 409)
      if (departStatus === 400) return reply({ error: { code: 'destination_outside_park', message: '目的地必須在內湖科學園區內' } }, 400)
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
    places.available = true
  })

  it('prefills the last trip, so one tap departs with the same settings (REQ-016, REQ-017)', async () => {
    const calls = fakeBackend([NO_TRIP])
    render(<App />)

    expect(await screen.findByRole('heading', { name: '今天載人嗎？' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /目的地\s*瑞光路 513 巷/ })).toBeInTheDocument()
    // The previewed route is in, so the departure carries its id.
    await within(await screen.findByRole('list', { name: '今天的路線' })).findByText('陽光街')
    await waitFor(() => expect(screen.getByRole('button', { name: '我出發了' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '我出發了' }))

    expect(await screen.findByRole('heading', { name: /目前沒有/ })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST' && c.path === '/driver/trips')?.body).toEqual({
      pickup_point_id: 1,
      destination: DESTINATION,
      capacity: 3,
      auto_accept: false,
      tag_filters: [],
      // The route the driver saw is the trip's route (DD-21, T26).
      preview_id: 1,
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

  it('searches a destination with Places, previews its route and departs to it (DD-32, DD-21)', async () => {
    const calls = fakeBackend([NO_TRIP], { defaults: NEVER_DEPARTED })
    render(<App />)
    await screen.findByRole('heading', { name: '第一次出發' })
    fireEvent.click(await screen.findByRole('radio', { name: '松山車站' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '目的地地址' }), { target: { value: '瑞光' } })
    fireEvent.click(await screen.findByRole('button', { name: /瑞光路 513 巷/ }))

    // The preview takes a position only and answers { route } (T20).
    await waitFor(() => expect(calls.find((c) => c.path === '/driver/route-preview')?.body).toEqual({ pickup_point_id: 1, destination: { lat: 25.0765, lng: 121.5742 } }))
    expect(await within(screen.getByRole('list', { name: '今天的路線' })).findByText('陽光街')).toBeInTheDocument()
    expect(screen.getByText('路線為估算')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '我出發了' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '我出發了' }))
    await screen.findByRole('heading', { name: /目前沒有/ })
    expect(calls.find((c) => c.method === 'POST' && c.path === '/driver/trips')?.body).toMatchObject({ destination: { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 } })
  })

  it('a place outside the park is flagged at once and not taken (DD-32, REQ-001)', async () => {
    const calls = fakeBackend([NO_TRIP], { defaults: NEVER_DEPARTED })
    render(<App />)
    await screen.findByRole('heading', { name: '第一次出發' })
    fireEvent.change(screen.getByRole('searchbox', { name: '目的地地址' }), { target: { value: '101' } })
    fireEvent.click(await screen.findByRole('button', { name: /台北 101/ }))

    expect(await screen.findByText('台北 101不在內湖科學園區內，請換一個地點。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /目的地\s*未填/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '我出發了' })).toBeDisabled()
    expect(calls.some((c) => c.path === '/driver/route-preview')).toBe(false)
  })

  it('departs on the previewed route: the departure carries the preview id (DD-21, T26)', async () => {
    const calls = fakeBackend([NO_TRIP])
    render(<App />)
    await waitFor(() => expect(calls.some((c) => c.path === '/driver/route-preview')).toBe(true))
    await waitFor(() => expect(screen.getByRole('button', { name: '我出發了' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '我出發了' }))
    await screen.findByRole('heading', { name: /目前沒有/ })
    expect(calls.find((c) => c.method === 'POST' && c.path === '/driver/trips')?.body).toMatchObject({ preview_id: 1 })
  })

  it('a refused preview is previewed again and the driver taps once more; no trip until then (DD-21, T26)', async () => {
    const calls = fakeBackend([NO_TRIP], { refusedPreviews: [1] })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: '我出發了' })).toBeEnabled())
    await within(await screen.findByRole('list', { name: '今天的路線' })).findByText('陽光街')
    fireEvent.click(screen.getByRole('button', { name: '我出發了' }))

    expect(await screen.findByText('路線已重新整理，確認後請再按一次「我出發了」。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '今天載人嗎？' })).toBeInTheDocument()
    await waitFor(() => expect(calls.filter((c) => c.path === '/driver/route-preview')).toHaveLength(2))

    await waitFor(() => expect(screen.getByRole('button', { name: '我出發了' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '我出發了' }))
    await screen.findByRole('heading', { name: /目前沒有/ })
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/driver/trips').map((c) => (c.body as { preview_id: number }).preview_id)).toEqual([1, 2])
  })

  it('a departure refused for a destination outside the park says so (REQ-001)', async () => {
    fakeBackend([NO_TRIP], { departStatus: 400 })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: '我出發了' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '我出發了' }))
    expect(await screen.findByText('目的地不在內湖科學園區內，請換一個目的地。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '今天載人嗎？' })).toBeInTheDocument()
  })

  it('without Places, the prefilled destination still departs (DD-32)', async () => {
    places.available = false
    const calls = fakeBackend([NO_TRIP])
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /目的地\s*瑞光路 513 巷/ }))
    fireEvent.change(screen.getByRole('searchbox', { name: '目的地地址' }), { target: { value: '瑞光' } })
    expect(await screen.findByText('目前無法搜尋地點，可以沿用已帶入的目的地。')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('button', { name: '我出發了' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '我出發了' }))
    expect(await screen.findByRole('heading', { name: /目前沒有/ })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST' && c.path === '/driver/trips')?.body).toMatchObject({ destination: DESTINATION })
  })

  it('marks the preview as an estimate only when the route is simulated (REQ-063)', async () => {
    fakeBackend([NO_TRIP], { route: { ...ROUTE, simulated: false } })
    render(<App />)
    expect(await within(await screen.findByRole('list', { name: '今天的路線' })).findByText('陽光街')).toBeInTheDocument()
    expect(screen.queryByText('路線為估算')).not.toBeInTheDocument()
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

  it('auto-accept confirms a waiting request with no tap, through the 確認 API (REQ-022, DD-33)', async () => {
    const calls = fakeBackend([{ trip_id: 5, pending: [request({})], passengers: [] }], { autoAccept: true })
    render(<App />)

    const passengers = await screen.findByRole('region', { name: '乘客' })
    expect(within(passengers).getByRole('button', { name: '瑞光路 513 巷的乘客已上車' })).toBeInTheDocument()
    await nextPoll()
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/driver/requests/7/accept'])
  })

  it('without auto-accept a request waits for the driver to confirm or decline (REQ-021)', async () => {
    const calls = fakeBackend([{ trip_id: 5, pending: [request({})], passengers: [] }])
    render(<App />)

    expect(await screen.findByRole('heading', { name: '有乘客要搭車' })).toBeInTheDocument()
    await nextPoll()
    await nextPoll()
    expect(calls.some((c) => c.path === '/trips/5')).toBe(true)
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
    expect(screen.getByRole('button', { name: '確認' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '婉拒' })).toBeEnabled()
  })

  it('an auto-accept answered elsewhere (409 not_waiting) shows no error and keeps polling (DD-33)', async () => {
    const calls = fakeBackend([{ trip_id: 5, pending: [request({ id: 8 })], passengers: [] }, DRIVING], { autoAccept: true })
    render(<App />)

    expect(await screen.findByRole('heading', { name: /目前沒有/ })).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/driver/requests/8/accept'])
    const polls = calls.filter((c) => c.path === '/driver/requests').length
    await nextPoll()
    expect(calls.filter((c) => c.path === '/driver/requests').length).toBeGreaterThan(polls)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/無法連線|錯誤/)).not.toBeInTheDocument()
  })

  it('forgets an ended auto-accept trip: a later manual trip with the same id waits for the tap (DD-29, DD-33)', async () => {
    // The mock backend numbers trips from the start again after a Demo reset: trip 5 auto-accepts,
    // a reset ends it, and the next trip 5 does not.
    let phase: 'auto' | 'reset' | 'manual' = 'auto'
    const posts: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = url.replace('/api', '')
        const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
        if (init.method === 'POST') {
          posts.push(path)
          phase = 'reset'
          return reply({ status: 'confirmed' })
        }
        if (path === '/driver/requests') {
          if (phase === 'reset') {
            phase = 'manual'
            return reply(NO_TRIP)
          }
          return reply({ trip_id: 5, pending: [request({ id: phase === 'auto' ? 7 : 8 })], passengers: [] })
        }
        if (path === '/trips/5') return reply(trip({ auto_accept: phase === 'auto' }))
        return reply({ error: { code: 'not_found', message: '' } }, 404)
      }),
    )
    render(<App />)

    await waitFor(() => expect(posts).toEqual(['/driver/requests/7/accept']))
    await nextPoll()
    await nextPoll()
    expect(await screen.findByRole('heading', { name: '有乘客要搭車' })).toBeInTheDocument()
    await nextPoll()
    expect(posts).toEqual(['/driver/requests/7/accept'])
    expect(screen.getByRole('button', { name: '確認' })).toBeEnabled()
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

  it('says no rider was taken when the trip ended empty (SC-D4)', async () => {
    fakeBackend([DRIVING, NO_TRIP], { ended: trip({ status: 'completed', completed_rides: 0 }) })
    render(<App />)
    await screen.findByRole('heading', { name: /目前沒有/ })
    await nextPoll()
    expect(await screen.findByText('這趟沒有載到乘客')).toBeInTheDocument()
  })

  it('goes back to the departure screen when a Demo reset cancels the running trip (DD-29)', async () => {
    fakeBackend([DRIVING, NO_TRIP], { ended: trip({ status: 'cancelled' }) })
    render(<App />)
    await screen.findByRole('heading', { name: /目前沒有/ })
    await nextPoll()
    expect(await screen.findByRole('heading', { name: '今天載人嗎？' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '已到達目的地' })).not.toBeInTheDocument()
  })

  it('has no map, settings entry or end-trip button anywhere while driving (DD-04, DD-30, REQ-019)', async () => {
    const onBoard = request({ id: 9, status: 'boarded', boarded: true })
    fakeBackend([{ trip_id: 5, pending: [request({})], passengers: [onBoard] }, { trip_id: 5, pending: [], passengers: [onBoard] }, DRIVING])
    render(<App />)
    const inTrip = () => {
      expect(screen.queryByTestId('map')).not.toBeInTheDocument()
      expect(screen.queryByText(/地圖未設定/)).not.toBeInTheDocument()
      expect(screen.queryByText(/設定|篩選乘客|可載人數|我的標籤|自動接受|結束行程/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '除錯' })).not.toBeInTheDocument()
    }
    // A request, with a passenger already on board.
    await screen.findByRole('heading', { name: '有乘客要搭車' })
    inTrip()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['確認', '婉拒'])
    // The passenger on board, no request.
    await nextPoll()
    await screen.findByRole('heading', { name: /目前沒有/ })
    inTrip()
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['瑞光路的乘客已下車'])
    // Nobody on board, no request: no buttons at all.
    await nextPoll()
    await waitFor(() => expect(screen.queryByRole('region', { name: '乘客' })).not.toBeInTheDocument())
    inTrip()
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('my tags carry the simulated 同企業 tag, selected and not tappable; the departure is unchanged (REQ-062, REQ-063, DD-43)', async () => {
    const calls = fakeBackend([NO_TRIP])
    render(<App />)
    // Shown as selected while collapsed, before any tag of the driver's own.
    // Open the row only once the prefill is in: loading it collapses every row (DepartureScreen).
    expect(await screen.findByRole('button', { name: /目的地\s*瑞光路 513 巷/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /我的標籤\s*同企業$/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /我的標籤/ }))

    const chip = await screen.findByText('同企業・內科示範科技')
    expect(chip.closest('p')).toHaveTextContent('模擬')
    expect(chip.closest('button')).toBeNull()
    // The chip renders at once; the operable tags come with the my-tags fetch.
    expect(within(await screen.findByRole('group', { name: '我的標籤' })).queryByText(/同企業/)).not.toBeInTheDocument()
    const before = calls.length
    fireEvent.click(chip)
    expect(calls.slice(before).filter((c) => c.method !== 'GET')).toEqual([])
    expect(screen.getByText('同企業・內科示範科技')).toBeInTheDocument()

    await within(await screen.findByRole('list', { name: '今天的路線' })).findByText('陽光街')
    await waitFor(() => expect(screen.getByRole('button', { name: '我出發了' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '我出發了' }))
    await screen.findByRole('heading', { name: /目前沒有/ })
    expect(calls.find((c) => c.method === 'POST' && c.path === '/driver/trips')?.body).toEqual({
      pickup_point_id: 1,
      destination: DESTINATION,
      capacity: 3,
      auto_accept: false,
      tag_filters: [],
      preview_id: 1,
    })
    expect(calls.some((c) => c.path.startsWith('/me/tags'))).toBe(false)
  })

  it('a request says 同企業乘客 with the pickup and drop-off, marked simulated, and adds no action (DD-04, DD-43, REQ-063)', async () => {
    fakeBackend([{ trip_id: 5, pending: [request({})], passengers: [] }])
    render(<App />)
    await screen.findByRole('heading', { name: '有乘客要搭車' })
    const line = screen.getByText('同企業乘客')
    expect(line).toHaveTextContent('模擬')
    expect(screen.getByText('松山車站')).toBeInTheDocument()
    expect(screen.getByText('瑞光路')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['確認', '婉拒'])
  })

  it('shows the arrival screen when the running trip ends by itself (UD-16)', async () => {
    fakeBackend([DRIVING, NO_TRIP])
    render(<App />)
    await screen.findByRole('heading', { name: /目前沒有/ })

    await nextPoll()
    expect(await screen.findByRole('heading', { name: '已到達目的地' })).toBeInTheDocument()
    expect(screen.getByText('瑞光路 513 巷')).toBeInTheDocument()
    // The rides finished on this trip (SC-D4, REQ-070).
    expect(screen.getByText('這趟載了 2 位乘客')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '好' }))
    expect(await screen.findByRole('heading', { name: '今天載人嗎？' })).toBeInTheDocument()
  })
})
