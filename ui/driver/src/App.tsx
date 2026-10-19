import { ApiError, PhoneShell, usePolling, type DriverTripResponse, type StatusBarTone, type TripView } from '@carpool/shared'
import { useEffect, useState } from 'react'
import { api, DEBUG, POLL_INTERVAL_MS } from './config'
import { DriverDebugMode } from './DriverDebugMode'
import { DepartureScreen } from './DepartureScreen'
import { LoadingScreen } from './LoadingScreen'
import { TripEndedScreen } from './TripEndedScreen'
import { TripIdleScreen } from './TripIdleScreen'
import { TripRequestScreen } from './TripRequestScreen'

const fetchTrip = () => api.get<DriverTripResponse>('/driver/trip')

/** A trip that just started has no requests or passengers yet. */
const justDeparted = (trip: TripView): DriverTripResponse => ({
  trip: { ...trip, ended_at: null, pending_request: null, passengers: [], completed_count: 0 },
})

export function App() {
  const polling = usePolling(fetchTrip, POLL_INTERVAL_MS)
  const trip = polling.data?.trip ?? null
  // The ended screen only follows a trip this session saw running; after a reload it's the departure screen.
  const [runningId, setRunningId] = useState<number | null>(null)
  const [endedId, setEndedId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (trip?.status === 'active' && trip.id !== runningId) setRunningId(trip.id)
    if (trip?.status === 'completed' && trip.id === runningId) {
      setEndedId(trip.id)
      setRunningId(null)
    }
  }, [trip, runningId])

  async function act(path: string) {
    setBusy(true)
    try {
      polling.mutate(await api.post<DriverTripResponse>(path))
    } catch (err) {
      // The request timed out or was cancelled meanwhile: show the current state.
      if (err instanceof ApiError && err.status === 409) polling.mutate(await fetchTrip().catch(() => polling.data!))
    } finally {
      setBusy(false)
    }
  }

  const offline = polling.error !== undefined
  let tone: StatusBarTone = 'light'
  let screen
  if (polling.data === undefined) {
    tone = 'dark'
    screen = <LoadingScreen failed={offline} />
  } else if (trip?.status === 'active' && trip.pending_request) {
    tone = 'dark'
    const request = trip.pending_request
    screen = (
      <TripRequestScreen
        trip={trip}
        request={request}
        busy={busy}
        offline={offline}
        onAccept={() => act(`/driver/requests/${request.id}/accept`)}
        onDecline={() => act(`/driver/requests/${request.id}/decline`)}
      />
    )
  } else if (trip?.status === 'active') {
    screen = (
      <TripIdleScreen
        trip={trip}
        busy={busy}
        offline={offline}
        onBoarded={(id) => act(`/driver/requests/${id}/board`)}
        onDropOff={(id) => act(`/driver/requests/${id}/complete`)}
      />
    )
  } else if (trip && trip.id === endedId) {
    screen = <TripEndedScreen trip={trip} onDone={() => setEndedId(null)} />
  } else {
    tone = 'dark'
    screen = (
      <DepartureScreen
        key={trip?.id ?? 'none'}
        onDeparted={(started) => polling.mutate(justDeparted(started))}
        onAlreadyActive={() => fetchTrip().then(polling.mutate, () => undefined)}
      />
    )
  }

  return (
    <PhoneShell roleLabel="駕駛" tone={tone}>
      {screen}
      {DEBUG && <DriverDebugMode />}
    </PhoneShell>
  )
}
