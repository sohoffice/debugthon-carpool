import { ApiError, createApiClient, type ApiClient, type DriverRequests, type TripView } from '@carpool/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FAST_FORWARD, POLL_INTERVAL_MS } from './config'
import { distanceAlong, makePath, pointAt, reportDistances, type FastSegment, type Motion, type SimPath } from './simulatorPath'
import { SIMULATOR_ROUTES, type SimulatorRoute } from './simulatorRoutes'

const TICK_MS = 1000
/** How often each account's running trip is looked up: within a second of driver4 departing it is reported, so it can be matched (DD-45). */
export const TRIP_CHECK_MS = 1000

export type SimulatorStatus =
  | { kind: 'waiting' }
  | { kind: 'no_trip' }
  | { kind: 'held' }
  | { kind: 'moving'; progress: number }
  | { kind: 'arrived' }
  | { kind: 'error'; message: string }

interface Track {
  tripId: number | null
  checkedAt: number
  /** When the car started moving; null while parked at the path start until a request (T63). */
  releasedAt: number | null
  /** When the first confirmed passenger was seen, for the fast-forward to the pickup (T63). */
  fastAt: number | null
  /** When the passenger was first seen on board, or gone after a ride, for the fast-forward to the end (T64). */
  endAt: number | null
  /** A confirmed or boarded passenger has been seen on this trip (T64). */
  hadPassenger: boolean
  /** Metres along the path last reported; -1 before the first report. */
  reported: number
  autoAccept: boolean
  requestsCheckedAt: number
  /** When the car's own requests were last read for the hold and the fast-forward (T63). */
  stageCheckedAt: number
}

interface Driver {
  api: ApiClient
  path: SimPath
  route: SimulatorRoute
}

const newTrack = (tripId: number | null, now: number, autoAccept: boolean, hold: boolean): Track => ({
  tripId,
  checkedAt: now,
  releasedAt: hold ? null : now,
  fastAt: null,
  endAt: null,
  hadPassenger: false,
  reported: -1,
  autoAccept,
  requestsCheckedAt: 0,
  stageCheckedAt: 0,
})

/** A parked track with a release from outside (release()) starts moving from when it came. */
const withRelease = (track: Track, releasedAt: number | undefined): Track =>
  track.releasedAt === null && releasedAt !== undefined ? { ...track, releasedAt } : track

/** The fast-forwards that have started, in path order; none with `?fast=0` (T63, T64). */
function fastSegments(route: SimulatorRoute, track: Track, length: number, fastForward: boolean): FastSegment[] {
  if (!fastForward) return []
  const segments: FastSegment[] = []
  if (route.fastForward && track.fastAt !== null) segments.push({ at: track.fastAt, ...route.fastForward })
  if (route.fastToEnd && track.endAt !== null) segments.push({ at: track.endAt, speedKmh: route.fastToEnd.speedKmh, untilM: length })
  return segments
}

const motionOf = (route: SimulatorRoute, track: Track, length: number, fastForward: boolean): Motion => ({
  releasedAt: track.releasedAt,
  speedKmh: route.speedKmh,
  fast: fastSegments(route, track, length, fastForward),
})

/** Still has to read its own requests: parked, or a fast-forward has yet to start (T63, T64). */
function watchesRequests(route: SimulatorRoute, track: Track, fastForward: boolean): boolean {
  if (track.releasedAt === null) return true
  if (!fastForward) return false
  if (route.fastForward && track.fastAt === null && track.reported < route.fastForward.untilM) return true
  return !!route.fastToEnd && track.endAt === null
}

/** The simulator's statuses, and `release` for a request seen elsewhere (the off-stage decline, DD-45). */
export interface Simulator {
  statuses: Record<string, SimulatorStatus>
  release: (account: string, tripId: number) => void
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
export function useSimulator(accounts: string[], running: boolean, fastForward = FAST_FORWARD): Simulator {
  const drivers = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(SIMULATOR_ROUTES).map(([name, route]): [string, Driver] => [
          name,
          { api: createApiClient('driver', name), path: makePath(route.path), route },
        ]),
      ),
    [],
  )
  const [statuses, setStatuses] = useState<Record<string, SimulatorStatus>>({})
  const tracks = useRef<Record<string, Track>>({})
  /** Trips released from outside, by trip id: when the release came (T63). */
  const releases = useRef<Record<number, number>>({})
  const busy = useRef<Set<string>>(new Set())
  const key = accounts.join(',')

  // A request seen once releases the trip for good, even after it is declined or reassigned: the
  // off-stage part declines driver5's within a second, maybe before this simulator reads it (T63).
  // Only recorded here; step() applies it after its awaits, so a step that was reading the trip
  // when it came cannot write the car back to parked.
  const release = useCallback((_account: string, tripId: number) => {
    if (releases.current[tripId] !== undefined) return
    releases.current = { ...releases.current, [tripId]: Date.now() }
  }, [])

  // Stopping forgets every track; the next start begins at each path's start again.
  useEffect(() => {
    if (running) return
    tracks.current = {}
    releases.current = {}
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
        const hold = !!driver.route.holdUntilRequest
        if (!trip) {
          tracks.current[name] = newTrack(null, now, false, hold)
          return setStatus(name, { kind: 'no_trip' })
        }
        // A new trip starts again from the beginning of the path, parked again if the route holds (T63).
        track =
          trip.id === track?.tripId
            ? { ...track, checkedAt: now, autoAccept: trip.auto_accept }
            : newTrack(trip.id, now, trip.auto_accept, hold)
        tracks.current[name] = track
      }
      if (track.tripId === null) return
      track = withRelease(track, releases.current[track.tripId])
      tracks.current[name] = track
      if (track.autoAccept && SEEDED_TRIP_ACCOUNTS.includes(name) && now - track.requestsCheckedAt >= POLL_INTERVAL_MS) {
        track = { ...track, requestsCheckedAt: now }
        tracks.current[name] = track
        await confirmPending(driver.api)
      }
      if (watchesRequests(driver.route, track, fastForward) && now - track.stageCheckedAt >= TRIP_CHECK_MS) {
        track = { ...track, stageCheckedAt: now }
        tracks.current[name] = track
        const { pending, passengers } = await driver.api.get<DriverRequests>('/driver/requests')
        // Read again: release() may have run while the request was out.
        track = withRelease(tracks.current[name], releases.current[track.tripId ?? -1])
        const releasedAt = track.releasedAt ?? (pending.length > 0 || passengers.length > 0 ? now : null)
        const fastAt = track.fastAt ?? (driver.route.fastForward && passengers.length > 0 ? now : null)
        // On board, or the ride is already over (完成 without 上車): either way, on to the end (T64).
        const boarded = passengers.some((p) => p.boarded)
        const gone = track.hadPassenger && passengers.length === 0
        const endAt = track.endAt ?? (driver.route.fastToEnd && (boarded || gone) ? now : null)
        track = { ...track, releasedAt, fastAt, endAt, hadPassenger: track.hadPassenger || passengers.length > 0 }
        tracks.current[name] = track
      }
      if (track.reported >= driver.path.length) return setStatus(name, { kind: 'arrived' })

      const along = distanceAlong(motionOf(driver.route, track, driver.path.length, fastForward), now, driver.path.length)
      const steps = track.reported < 0 ? [0, ...reportDistances(0, along)] : reportDistances(track.reported, along)
      // One at a time and in order: the backend reads them as the car's track (DD-06).
      for (const d of steps) {
        await driver.api.post('/location', pointAt(driver.path, d))
        track = { ...track, reported: d }
        tracks.current[name] = track
      }
      if (track.releasedAt === null) return setStatus(name, { kind: 'held' })
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
  }, [running, key, drivers, fastForward])

  return { statuses, release }
}
