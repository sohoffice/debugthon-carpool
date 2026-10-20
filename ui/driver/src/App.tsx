import { ApiError, PhoneShell, usePolling, type DriverRequests, type StatusBarTone, type TripView } from '@carpool/shared'
import { useEffect, useState } from 'react'
import { api, DEBUG, POLL_INTERVAL_MS } from './config'
import { DriverDebugMode } from './DriverDebugMode'
import { DepartureScreen } from './DepartureScreen'
import { LoadingScreen } from './LoadingScreen'
import { TripEndedScreen } from './TripEndedScreen'
import { TripIdleScreen } from './TripIdleScreen'
import { TripRequestScreen } from './TripRequestScreen'

const fetchRequests = () => api.get<DriverRequests>('/driver/requests')

export function App() {
  const polling = usePolling(fetchRequests, POLL_INTERVAL_MS)
  const tripId = polling.data?.trip_id ?? null
  // The ended screen only follows a trip this session saw running; after a reload it's the departure screen.
  const [runningId, setRunningId] = useState<number | null>(null)
  const [ended, setEnded] = useState<TripView | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (tripId !== null && tripId !== runningId) setRunningId(tripId)
    if (tripId === null && runningId !== null) {
      // The running trip is gone: it ended by itself at the destination (UD-16, DD-30).
      setRunningId(null)
      api.get<TripView>(`/trips/${runningId}`).then((t) => t.status === 'completed' && setEnded(t), () => undefined)
    }
  }, [tripId, runningId])

  async function act(path: string) {
    setBusy(true)
    try {
      await api.post(path)
    } catch (err) {
      // 409 not_waiting / invalid_state: answered elsewhere or timed out; the refresh shows the outcome.
      if (!(err instanceof ApiError && err.status === 409)) return
    } finally {
      setBusy(false)
    }
    polling.mutate(await fetchRequests().catch(() => polling.data!))
  }

  const offline = polling.error !== undefined
  let tone: StatusBarTone = 'light'
  let screen
  if (polling.data === undefined) {
    tone = 'dark'
    // 404: the backend answers but does not have this API yet (not a connection problem).
    const missing = polling.error instanceof ApiError && polling.error.status === 404 ? polling.error.message : undefined
    screen = <LoadingScreen failed={offline} missing={missing} />
  } else if (tripId !== null && polling.data.pending.length > 0) {
    tone = 'dark'
    const request = polling.data.pending[0]
    screen = (
      <TripRequestScreen
        passengers={polling.data.passengers}
        request={request}
        busy={busy}
        offline={offline}
        onAccept={() => act(`/driver/requests/${request.id}/accept`)}
        onDecline={() => act(`/driver/requests/${request.id}/decline`)}
      />
    )
  } else if (tripId !== null) {
    screen = (
      <TripIdleScreen
        passengers={polling.data.passengers}
        busy={busy}
        offline={offline}
        onBoarded={(id) => act(`/driver/requests/${id}/board`)}
        onDropOff={(id) => act(`/driver/requests/${id}/complete`)}
      />
    )
  } else if (ended) {
    screen = <TripEndedScreen trip={ended} onDone={() => setEnded(null)} />
  } else {
    tone = 'dark'
    screen = (
      <DepartureScreen
        // A trip that just started has no requests or passengers yet.
        onDeparted={(started) => polling.mutate({ trip_id: started.id, pending: [], passengers: [] })}
        onAlreadyActive={() => fetchRequests().then(polling.mutate, () => undefined)}
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
