// Static site only: the passenger tour (T70, DD-46). The visitor is the passenger and presses
// every passenger button; the tour moves 3 simulated cars to 松山車站 and confirms for the one the
// backend matches, so the screen is confirmed about 3 s after the request. Matching stays the backend's (REQ-031, REQ-042).
import { ApiError, createApiClient, decodePolyline, getAccountFromUrl, type CurrentRequest, type LatLng, type RequestStatus, type RequestStatusView, type TripView } from '@carpool/shared'
import { createSimulator } from '../showcase/src/simulator.ts'
import { makePath, pointAt } from '../showcase/src/simulatorPath.ts'
import { SIMULATOR_ROUTES, type SimulatorRoute } from '../showcase/src/simulatorRoutes.ts'
import type { CoachStep } from './coachBar.ts'
import { isEmbedded, runTour } from './tour.ts'

/** passenger1 has habitual data, so the app opens on the supply board (UD-18). Like passenger/src/config.ts. */
const DEFAULT_ACCOUNT = 'passenger1'
/** The seeded auto-accepting trips at 松山車站 (DD-33); the backend picks which one (REQ-042). */
export const TOUR_DRIVERS = ['driver1', 'driver2', 'driver3']
/**
 * The matched car confirms this long after the request, so with the passenger app's 1 s poll the
 * screen turns to 已確認 within about 3 s of 送出請求 (#210).
 */
export const CONFIRM_DELAY_MS = 2000
const SUBMIT_SHEET = '[role="dialog"][aria-label="送出搭車請求"]'
/** The board's main button: back on the board after a closed ride (完成畫面的回到首頁, no car, too far). */
const BOARD_BUTTON = '今天我要搭'
/** 松山車站, where every showcase path and every trip route meet. */
export const PICKUP = { lat: 25.049806, lng: 121.578206 }
/** Where each car stops after 我已上車: this far before its trip's end, outside the mock's 50 m arrival radius. */
const STOP_SHORT_M = 80
/** Past the pickup's 80 m radius and 25 m leave margin (DD-06), plus a little room. */
const PAST_PICKUP_M = 130
/** The same fast-forward speeds as the showcase's driver4 (T63, T64). */
const FAST_TO_PICKUP_KMH = 2400
const FAST_TO_DROPOFF_KMH = 4000
/** Twice a second, so the confirm is within half a second of CONFIRM_DELAY_MS. */
const TOUR_POLL_MS = 500

export interface PassengerTourState {
  status: RequestStatus | null
  sheetOpen: boolean
}

const total = 6
export const PASSENGER_STEPS: CoachStep[] = [
  { index: 0, total, text: '有 3 輛車順路經過松山車站，按「今天我要搭」' },
  { index: 1, total, text: '確認一下要去哪，按「送出請求」' },
  { index: 2, total, text: '正在幫你找順路的駕駛…' },
  { index: 3, total, text: '配到車了！車到站後按「我已上車」' },
  { index: 4, total, text: '在車上了，到公司後按「我已下車，結束共乘」' },
  { index: 5, total, text: '到了！今天少開一輛車進內科', switchTo: { label: '換成駕駛體驗', href: '../driver/index.html' } },
]

/** Which of the six steps the passenger is on (portal-redesign 劇本 B); 0-based. */
export function detectPassengerStep({ status, sheetOpen }: PassengerTourState): number {
  switch (status) {
    case 'waiting_driver':
      return 2
    case 'confirmed':
      return 3
    case 'boarded':
      return 4
    case 'completed':
      return 5
    default:
      // No request yet, or no car / too far: the board, where the visitor tries again.
      return sheetOpen ? 1 : 0
  }
}

export function dueToConfirm(requestedAt: number, now: number): boolean {
  return now - requestedAt >= CONFIRM_DELAY_MS
}

/** `points` cut STOP_SHORT_M before their end, so the car parks short of the destination. */
function cutShort(points: [number, number][]): [number, number][] {
  const path = makePath(points)
  const cutAt = path.length - STOP_SHORT_M
  const kept = points.filter((_, i) => path.cumulative[i] < cutAt)
  const end = pointAt(path, cutAt)
  return [...kept, [end.lat, end.lng]]
}

/**
 * A tour car's route: the showcase's approach to 松山車站, then the trip's own route (`onward`, from
 * the pickup) cut short of its end. The static site's mock moves a car by projecting each report onto
 * its trip path (followReports), so off that path the car would stick at the pickup (#217 review).
 */
export function tourRoute(route: SimulatorRoute, onward: LatLng[]): SimulatorRoute {
  const pickupIndex = route.path.findIndex(([lat, lng]) => lat === PICKUP.lat && lng === PICKUP.lng)
  if (pickupIndex < 0) throw new Error('tour route: the path does not pass 松山車站')
  const approach = route.path.slice(0, pickupIndex + 1)
  const pickupM = makePath(approach).length
  return {
    ...route,
    path: [...approach, ...cutShort(onward.map((p): [number, number] => [p.lat, p.lng])).slice(1)],
    // Parked until a request, so the board keeps 3 cars however long the visitor looks (T63).
    holdUntilRequest: true,
    fastForward: { speedKmh: FAST_TO_PICKUP_KMH, untilM: Math.round(pickupM + PAST_PICKUP_M) },
    fastToEnd: { speedKmh: FAST_TO_DROPOFF_KMH },
  }
}

/** Each tour car's route, from its trip's route as the backend planned it (DD-21). */
async function tourRoutes(): Promise<Record<string, SimulatorRoute>> {
  const entries = await Promise.all(
    TOUR_DRIVERS.map(async (name): Promise<[string, SimulatorRoute]> => {
      const trip = await createApiClient('driver', name).get<TripView>('/driver/trips/current')
      if (!trip.route) throw new Error(`tour route: ${name}'s trip has no route`)
      return [name, tourRoute(SIMULATOR_ROUTES[name], decodePolyline(trip.route.polyline))]
    }),
  )
  return Object.fromEntries(entries)
}

/** Confirms the request for whichever tour car the backend sent it to, like that driver's 確認 (DD-33). */
async function confirmFor(requestId: number) {
  for (const name of TOUR_DRIVERS) {
    const driver = createApiClient('driver', name)
    const { pending } = await driver.get<{ pending: { id: number }[] }>('/driver/requests')
    if (!pending.some((r) => r.id === requestId)) continue
    await driver.post(`/driver/requests/${requestId}/accept`).catch((err) => {
      // 409: answered or timed out in the meantime.
      if (!(err instanceof ApiError && err.status === 409)) throw err
    })
    return
  }
}

async function startTour() {
  const passenger = createApiClient('passenger', getAccountFromUrl(DEFAULT_ACCOUNT))
  // /current is empty once the request is closed: the last one is read by its id.
  let lastId: number | null = null
  const confirmed = new Set<number>()

  async function read(): Promise<PassengerTourState & { request: RequestStatusView | null }> {
    const sheetOpen = !!document.querySelector(SUBMIT_SHEET)
    const { request: open } = await passenger.get<CurrentRequest>('/passenger/requests/current')
    if (open) {
      lastId = open.id
      return { status: open.status, sheetOpen, request: open }
    }
    // Closed: the last ride counts until the app is back on the board. Checked on the board, not on
    // 共乘完成, which shows up to one poll after the backend has closed the ride.
    const onBoard = [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === BOARD_BUTTON)
    if (lastId === null || onBoard) {
      lastId = null
      return { status: null, sheetOpen, request: null }
    }
    const last = await passenger.get<RequestStatusView>(`/passenger/requests/${lastId}`)
    return { status: last.status, sheetOpen, request: last }
  }

  async function act({ request }: { request: RequestStatusView | null }) {
    if (!request || request.status !== 'waiting_driver' || confirmed.has(request.id)) return
    // From when it was sent, not when this round saw it, so the confirm lands at about 3 s.
    if (!dueToConfirm(Date.parse(request.created_at), Date.now())) return
    await confirmFor(request.id)
    // Only once it went through: a failed round tries again on the next.
    confirmed.add(request.id)
  }

  createSimulator({ accounts: TOUR_DRIVERS, fastForward: true, routes: await tourRoutes() }).start()
  runTour({ read, detect: detectPassengerStep, steps: PASSENGER_STEPS, act, intervalMs: TOUR_POLL_MS })
}

// The showcase embeds this same page and runs its own Demo there: no cars, no bar (DD-46).
if (typeof window !== 'undefined' && !isEmbedded()) startTour().catch((err) => console.warn('static tour:', err))
