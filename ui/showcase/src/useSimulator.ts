import { ApiError, createApiClient, type ApiClient, type DriverRequests, type TripView } from '@carpool/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { POLL_INTERVAL_MS } from './config'
import { distanceTravelled, makePath, pointAt, reportDistances, type SimPath } from './simulatorPath'
import { SIMULATOR_ROUTES } from './simulatorRoutes'

const TICK_MS = 1000
/** How often each account's running trip is looked up: within a second of driver4 departing it is reported, so it can be matched (DD-45). */
export const TRIP_CHECK_MS = 1000

export type SimulatorStatus =
  | { kind: 'waiting' }
  | { kind: 'no_trip' }
  | { kind: 'moving'; progress: number }
  | { kind: 'arrived' }
  | { kind: 'error'; message: string }

interface Track {
  tripId: number | null
  checkedAt: number
  startedAt: number
  /** Metres along the path last reported; -1 before the first report. */
  reported: number
  autoAccept: boolean
  requestsCheckedAt: number
}

interface Driver {
  api: ApiClient
  path: SimPath
  speedKmh: number
}

export const SIMULATED_ACCOUNTS = Object.keys(SIMULATOR_ROUTES)

/**
 * The SQL-seeded simulated trips. Nobody drives them from the driver UI, so the simulator confirms
 * their requests when they auto-accept (DD-14, DD-33). driver4 and driver5 depart from the driver
 * UI, which confirms by itself; confirming for them too would send every confirm twice.
 */
export const SEEDED_TRIP_ACCOUNTS = ['driver1', 'driver2', 'driver3']

/** Confirms every request waiting for this driver, like the 確認 button. */
async function confirmPending(api: ApiClient) {
  const { pending } = await api.get<DriverRequests>('/driver/requests')
  for (const request of pending) {
    await api.post(`/driver/requests/${request.id}/accept`).catch((err) => {
      // 409 not_waiting: timed out or answered in the meantime.
      if (!(err instanceof ApiError && err.status === 409)) throw err
    })
  }
}

/**
 * The simulator (DD-14, T08), run by the showcase from 開始 Demo (DD-45): while running, each selected driver with a running trip moves along
 * its predefined path at its speed and reports positions through the public location API. Position
 * comes from elapsed time, so a throttled background tab catches up instead of falling behind.
 * For the seeded trips it also confirms requests when the trip auto-accepts (DD-33).
 * Nothing is saved: reloading the showcase stops it (UD-30).
 */
export function useSimulator(accounts: string[], running: boolean): Record<string, SimulatorStatus> {
  const drivers = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(SIMULATOR_ROUTES).map(([name, route]): [string, Driver] => [
          name,
          { api: createApiClient('driver', name), path: makePath(route.path), speedKmh: route.speedKmh },
        ]),
      ),
    [],
  )
  const [statuses, setStatuses] = useState<Record<string, SimulatorStatus>>({})
  const tracks = useRef<Record<string, Track>>({})
  const busy = useRef<Set<string>>(new Set())
  const key = accounts.join(',')

  // Stopping forgets every track; the next start begins at each path's start again.
  useEffect(() => {
    if (running) return
    tracks.current = {}
    setStatuses({})
  }, [running])

  useEffect(() => {
    if (!running) return
    const setStatus = (name: string, status: SimulatorStatus) => setStatuses((s) => ({ ...s, [name]: status }))

    async function step(name: string) {
      const driver = drivers[name]
      const now = Date.now()
      let track = tracks.current[name]
      if (!track || now - track.checkedAt >= TRIP_CHECK_MS) {
        const trip = await driver.api.get<TripView>('/driver/trips/current').catch((err) => {
          if (err instanceof ApiError && err.status === 404) return null
          throw err
        })
        if (!trip) {
          tracks.current[name] = { tripId: null, checkedAt: now, startedAt: now, reported: -1, autoAccept: false, requestsCheckedAt: 0 }
          return setStatus(name, { kind: 'no_trip' })
        }
        // A new trip starts again from the beginning of the path.
        track =
          trip.id === track?.tripId
            ? { ...track, checkedAt: now, autoAccept: trip.auto_accept }
            : { tripId: trip.id, checkedAt: now, startedAt: now, reported: -1, autoAccept: trip.auto_accept, requestsCheckedAt: 0 }
        tracks.current[name] = track
      }
      if (track.tripId === null) return
      if (track.autoAccept && SEEDED_TRIP_ACCOUNTS.includes(name) && now - track.requestsCheckedAt >= POLL_INTERVAL_MS) {
        track = { ...track, requestsCheckedAt: now }
        tracks.current[name] = track
        await confirmPending(driver.api)
      }
      if (track.reported >= driver.path.length) return setStatus(name, { kind: 'arrived' })

      const along = distanceTravelled(driver.speedKmh, track.startedAt, now, driver.path.length)
      const steps = track.reported < 0 ? [0, ...reportDistances(0, along)] : reportDistances(track.reported, along)
      // One at a time and in order: the backend reads them as the car's track (DD-06).
      for (const d of steps) {
        await driver.api.post('/location', pointAt(driver.path, d))
        track = { ...track, reported: d }
        tracks.current[name] = track
      }
      setStatus(name, track.reported >= driver.path.length ? { kind: 'arrived' } : { kind: 'moving', progress: track.reported / driver.path.length })
    }

    const tick = () => {
      for (const name of accounts) {
        if (busy.current.has(name)) continue
        busy.current.add(name)
        step(name)
          .catch((err) => setStatus(name, { kind: 'error', message: err instanceof Error ? err.message : String(err) }))
          .finally(() => busy.current.delete(name))
      }
    }
    accounts.forEach((name) => setStatus(name, { kind: 'waiting' }))
    tick()
    const timer = setInterval(tick, TICK_MS)
    return () => clearInterval(timer)
    // `key` stands for the account list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, key, drivers])

  return statuses
}
