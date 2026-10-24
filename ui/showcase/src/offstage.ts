import { ApiError, createApiClient, type ApiClient, type DriverRequests, type TripView } from '@carpool/shared'
import type { AddLog } from './log'

/** driver5's departure: same pickup and destination as driver4, no auto-accept, no tag filters (DD-45 step 2). */
const DRIVER5_CAPACITY = 3

export interface OffstageDrivers {
  driver4: ApiClient
  driver5: ApiClient
}

export const stageDrivers = (): OffstageDrivers => ({
  driver4: createApiClient('driver', 'driver4'),
  driver5: createApiClient('driver', 'driver5'),
})

interface State {
  /** driver4's trip already logged as departed; null while it has none. */
  driver4Trip: number | null
  /** driver4's trip driver5 has followed (or reused its own for); retried until done. */
  followed: number | null
  /** driver5's trip being watched; null while it has none. */
  driver5Trip: number | null
  passedTold: boolean
  declined: ReadonlySet<number>
  offline: boolean
}

const INITIAL: State = { driver4Trip: null, followed: null, driver5Trip: null, passedTold: false, declined: new Set(), offline: false }

/** Tells the simulator a stage driver's trip has had a request, so it stops holding the car (T63). */
export type OnRequest = (account: keyof OffstageDrivers, tripId: number) => void

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** The backend answered and refused; anything else (no answer, the dev proxy's 502) means it is not reachable. */
const isRefusal = (err: unknown) => err instanceof ApiError && err.status < 500

/**
 * The off-stage part of the Demo (DD-45 steps 2-4), one round per call: driver5 follows driver4 out
 * and declines every request it gets, so the request goes on to driver4 (REQ-049, REQ-050). A round
 * that cannot reach the backend is logged once and simply runs again on the next call.
 */
export function createOffstage(drivers: OffstageDrivers, log: AddLog, onRequest: OnRequest = () => {}) {
  let state = INITIAL

  /** driver5 departs to driver4's destination, unless it is already driving. */
  async function follow(driver5Running: boolean) {
    if (driver5Running) return log('driver5 已經在行程中，沿用這趟')
    const trip = await drivers.driver4.get<TripView>('/driver/trips/current')
    try {
      await drivers.driver5.post('/driver/trips', {
        pickup_point_id: trip.pickup_point.id,
        destination: trip.destination,
        capacity: DRIVER5_CAPACITY,
        auto_accept: false,
        tag_filters: [],
      })
      log('driver5 跟著出發了')
    } catch (err) {
      if (!isRefusal(err)) throw err
      log(`driver5 出發失敗：${reason(err)}`, true)
    }
  }

  async function decline(id: number, passengerName: string) {
    try {
      await drivers.driver5.post(`/driver/requests/${id}/decline`)
      log(`driver5 婉拒了${passengerName}的請求`)
    } catch (err) {
      if (!isRefusal(err)) throw err
      // 409 not_waiting: timed out or answered in the meantime, nothing left to decline.
      if (!(err instanceof ApiError && err.status === 409)) log(`driver5 婉拒失敗：${reason(err)}`, true)
    }
    state = { ...state, declined: new Set([...state.declined, id]) }
  }

  async function round() {
    const d4 = await drivers.driver4.get<DriverRequests>('/driver/requests')
    let d5 = await drivers.driver5.get<DriverRequests>('/driver/requests')

    if (d4.trip_id !== state.driver4Trip) {
      state = { ...state, driver4Trip: d4.trip_id }
      if (d4.trip_id !== null) log('driver4 出發了')
    }
    if (d4.trip_id !== null && d4.trip_id !== state.followed) {
      await follow(d5.trip_id !== null)
      state = { ...state, followed: d4.trip_id }
      d5 = await drivers.driver5.get<DriverRequests>('/driver/requests')
    }

    // Before declining: once declined, the request is gone from what the simulator reads (T63).
    for (const [account, requests] of [['driver4', d4], ['driver5', d5]] as const) {
      if (requests.trip_id !== null && requests.pending.length + requests.passengers.length > 0) onRequest(account, requests.trip_id)
    }
    for (const request of d5.pending) {
      if (!state.declined.has(request.id)) await decline(request.id, request.passenger_name)
    }

    if (d5.trip_id === null) {
      if (state.driver5Trip !== null) log('driver5 沒有進行中的行程了')
      state = { ...state, driver5Trip: null, passedTold: false }
      return
    }
    if (d5.trip_id !== state.driver5Trip) state = { ...state, driver5Trip: d5.trip_id, passedTold: false }
    if (!state.passedTold) {
      const trip = await drivers.driver5.get<TripView>(`/trips/${d5.trip_id}`)
      if (trip.passed_pickup) {
        log('注意：driver5 已經過上車點，之後的請求會直接配給 driver4')
        state = { ...state, passedTold: true }
      }
    }
  }

  /** One round; never throws, so the caller just runs it again a second later (DD-45 step 4). */
  return async function tick() {
    try {
      await round()
      if (state.offline) log('後端恢復了')
      state = { ...state, offline: false }
    } catch {
      if (!state.offline) log('連不到後端，每秒重試', true)
      state = { ...state, offline: true }
    }
  }
}
