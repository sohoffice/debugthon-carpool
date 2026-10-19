import type { DriverTrip, DriverTripResponse } from '@carpool/shared'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { POLL_INTERVAL_MS } from './config'

const PICKUP = { id: 1, name: '松山車站', lat: 25.0498, lng: 121.5782, radius_m: 80 }
const DESTINATION = { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }
const ROUTE = { polyline: '', distance_m: 4400, duration_s: 1200, stops: [{ id: 9, stop_id: 1116, name: '陽光街', lat: 0, lng: 0 }], simulated: true }

function trip(change: Partial<DriverTrip>): DriverTrip {
  return {
    id: 4,
    status: 'completed',
    pickup_point: PICKUP,
    destination: DESTINATION,
    capacity: 3,
    auto_accept: false,
    tag_filters: [],
    route: ROUTE,
    started_at: '2026-10-23T08:00:00Z',
    ended_at: '2026-10-23T08:20:00Z',
    pending_request: null,
    passengers: [],
    completed_count: 0,
    simulated: false,
    ...change,
  }
}

/** Answers like the backend; `tripResponses` are served in order for GET /driver/trip, the last one repeats. */
function fakeBackend(tripResponses: DriverTripResponse[]) {
  const calls: { method: string; path: string; body: unknown }[] = []
  let index = 0
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace('/api', '')
    const method = init.method ?? 'GET'
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (path === '/driver/trip') return reply(tripResponses[Math.min(index++, tripResponses.length - 1)])
    if (path === '/pickup-points') return reply([PICKUP])
    if (path === '/tags') return reply([{ id: 1, name: '不抽菸', issuer: 'self', selected: false }])
    if (path === '/driver/profile') return reply({ usual_pickup_point: null, usual_destination: null, capacity: null })
    if (path === '/driver/route-preview') return reply(ROUTE)
    if (path.startsWith('/places')) return reply([DESTINATION])
    if (method === 'POST' && path === '/driver/trips') return reply({ trip: trip({ id: 5, status: 'active', ended_at: null }) })
    if (method === 'POST' && path.endsWith('/accept')) return reply({ trip: trip({ id: 5, status: 'active', passengers: [{ request_id: 7, dropoff: DESTINATION }] }) })
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
    const calls = fakeBackend([{ trip: trip({}) }])
    render(<App />)

    expect(await screen.findByRole('heading', { name: '今天載人嗎？' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /目的地\s*瑞光路 513 巷/ })).toBeInTheDocument()
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

  it('cannot depart the first time until a destination is chosen', async () => {
    fakeBackend([{ trip: null }])
    render(<App />)

    expect(await screen.findByRole('heading', { name: '第一次出發' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '我出發了' })).toBeDisabled()
  })

  it('a request turns the screen into the request view; confirming goes back to waiting', async () => {
    const pending = { id: 7, pickup_point: PICKUP, dropoff: { name: '瑞光路', lat: 0, lng: 0 } }
    const calls = fakeBackend([{ trip: trip({ id: 5, status: 'active', pending_request: pending }) }])
    render(<App />)

    expect(await screen.findByRole('heading', { name: '有乘客要搭車' })).toBeInTheDocument()
    expect(screen.getByText('瑞光路')).toBeInTheDocument()
    expect(screen.queryByText(/地圖/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '確認' }))

    const onBoard = await screen.findByRole('region', { name: '車上乘客' })
    expect(within(onBoard).getByRole('button', { name: '瑞光路 513 巷的乘客已下車' })).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/driver/requests/7/accept')).toBe(true)
  })

  it('shows the arrival screen when the running trip ends by itself (UD-16)', async () => {
    fakeBackend([{ trip: trip({ id: 5, status: 'active' }) }, { trip: trip({ id: 5, status: 'completed', completed_count: 2 }) }])
    render(<App />)
    await screen.findByRole('heading', { name: /目前沒有/ })

    await nextPoll()
    expect(await screen.findByRole('heading', { name: '已到達目的地' })).toBeInTheDocument()
    expect(screen.getByText('今天載了 2 位乘客')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '好' }))
    expect(await screen.findByRole('heading', { name: '今天載人嗎？' })).toBeInTheDocument()
  })
})
