import {
  ApiError,
  usePolling,
  type BusStop,
  type LatLng,
  type PickupPoint,
  type RequestStatusView,
  type RequestView,
  type TripView,
  type Vehicle,
} from '@carpool/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BoardedScreen } from './BoardedScreen'
import { CompletedScreen, rideMinutesOf } from './CompletedScreen'
import { api, POLL_INTERVAL_MS, REASSIGN_HOLD_MS } from './config'
import { ConfirmedScreen } from './ConfirmedScreen'
import { MatchNotification } from './MatchNotification'
import { NoMatchScreen } from './NoMatchScreen'
import { minutesOf } from './search'
import { TooFarScreen } from './TooFarScreen'
import { useLocationReporting } from './useLocationReporting'
import { WaitingScreen } from './WaitingScreen'

const isOpen = (r: RequestView) => r.status === 'waiting_driver' || r.status === 'confirmed' || r.status === 'boarded'

interface RequestFlowProps {
  /** Just submitted, or the open request found on load. */
  initial: RequestStatusView
  /** Submitted in this session: a match right away still gets the notification. */
  fresh: boolean
  position: LatLng | null
  /** The status carries ids only; names come from these lists. */
  pickupPoints: PickupPoint[]
  busStops: BusStop[]
  /** Back to the supply board, with an optional one-line notice. */
  onBack: (notice: string | null) => void
  /** Whether the request is still open, i.e. positions are being reported (debug mode shows it). */
  onOpenChange?: (open: boolean) => void
}

/** 7.4-7.9: follows the request by polling until it is over (REQ-053). */
export function RequestFlow({ initial, fresh, position, pickupPoints, busStops, onBack, onOpenChange }: RequestFlowProps) {
  const fetchRequest = useCallback(() => api.get<RequestStatusView>(`/passenger/requests/${initial.id}`), [initial.id])
  const [open, setOpen] = useState(isOpen(initial))
  const polling = usePolling(fetchRequest, POLL_INTERVAL_MS, open)
  const request = polling.data ?? initial
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [celebrate, setCelebrate] = useState(false)
  const previous = useRef<RequestView['status'] | null>(fresh ? 'waiting_driver' : initial.status)
  // The backend sends the car and trip only while confirmed (DD-27); keep them for the boarded screen.
  const [vehicle, setVehicle] = useState<Vehicle | null>(initial.vehicle)
  const [trip, setTrip] = useState<TripView | null>(initial.trip)

  useEffect(() => setOpen(isOpen(request)), [request])
  useEffect(() => onOpenChange?.(open), [open, onOpenChange])
  useLocationReporting(position, isOpen(request))

  useEffect(() => {
    if (request.vehicle) setVehicle(request.vehicle)
    if (request.trip) setTrip(request.trip)
  }, [request])

  // Boarded after a reload: the route still comes from the trip.
  const boardedTripId = request.status === 'boarded' ? request.trip_id : null
  useEffect(() => {
    if (trip || boardedTripId === null) return
    let cancelled = false
    api.get<TripView>(`/trips/${boardedTripId}`).then((t) => !cancelled && setTrip(t), () => undefined)
    return () => {
      cancelled = true
    }
  }, [trip, boardedTripId])

  // A driver declined or timed out while we watched: hold on 駕駛無法載你 for a moment so the step
  // is seen, even though the backend has already moved the request to the next car (REQ-050).
  // A request just sent counts from 0: the first driver can decline before the first status read.
  const reassignedSeen = useRef(fresh ? 0 : initial.reassigned_count)
  const [declined, setDeclined] = useState(false)
  useEffect(() => {
    if (request.reassigned_count <= reassignedSeen.current) return
    reassignedSeen.current = request.reassigned_count
    setDeclined(true)
  }, [request])
  useEffect(() => {
    if (!declined) return
    const timer = setTimeout(() => setDeclined(false), REASSIGN_HOLD_MS)
    return () => clearTimeout(timer)
  }, [declined])

  // The moment a car is matched: simulated notification and the one choreographed transition (UD-10, UD-12).
  useEffect(() => {
    if (request.status === 'confirmed' && previous.current === 'waiting_driver' && request.vehicle && request.pickup_point) {
      const eta = request.eta_s === null ? '' : ` ${minutesOf(request.eta_s)} 分鐘後到`
      setNotice(`${request.vehicle.plate}${eta}${request.pickup_point.name}`)
      setCelebrate(true)
    }
    previous.current = request.status
  }, [request])

  async function act(action: 'board' | 'complete') {
    setBusy(true)
    setError(null)
    try {
      await api.post<RequestView>(`/passenger/requests/${request.id}/${action}`)
    } catch (err) {
      // 409 invalid_state: the state moved on meanwhile; the refresh below shows it.
      setError(err instanceof ApiError && err.status < 500 ? err.message : '沒有送出成功，請再按一次。')
    } finally {
      setBusy(false)
    }
    polling.mutate(await fetchRequest().catch(() => request))
  }

  const closeNotice = useCallback(() => setNotice(null), [])
  const back = () => onBack(null)
  const pickupName = request.pickup_point?.name ?? pickupPoints.find((p) => p.id === request.pickup_point_id)?.name ?? '上車點'
  const stopId = request.dropoff_bus_stop_id
  const dropoffName = stopId === null ? (trip?.destination.name ?? null) : (busStops.find((s) => s.id === stopId)?.name ?? null)

  let screen
  if (request.status === 'waiting_driver') {
    screen = <WaitingScreen pickupName={pickupName} reassigned={request.reassigned_count > 0} declined={declined} />
  } else if (request.status === 'confirmed' && request.pickup_point && request.vehicle && request.trip) {
    screen = (
      <ConfirmedScreen
        request={{ ...request, pickup_point: request.pickup_point, vehicle: request.vehicle, trip: request.trip }}
        celebrate={celebrate}
        busy={busy}
        onBoarded={() => act('board')}
      />
    )
  } else if (request.status === 'boarded') {
    screen = <BoardedScreen dropoffName={dropoffName} dropoffStopId={stopId} vehicle={vehicle} trip={trip} busy={busy} onDone={() => act('complete')} />
  } else if (request.status === 'no_match') {
    screen = <NoMatchScreen pickupName={pickupName} onBack={back} />
  } else if (request.status === 'rejected') {
    screen = <TooFarScreen pickupName={pickupName} message={request.message ?? '離上車點太遠。'} onBack={back} />
  } else if (request.status === 'completed') {
    screen = (
      <CompletedScreen
        pickupName={pickupName}
        dropoffName={dropoffName}
        vehicle={vehicle}
        rideMinutes={rideMinutesOf(request.boarded_at, request.completed_at)}
        onDone={back}
      />
    )
  } else {
    screen = null
  }

  return (
    <>
      {screen}
      {notice && <MatchNotification text={notice} onClose={closeNotice} />}
      {(error || polling.error) && (
        <p role="alert" className="absolute inset-x-6 bottom-[calc(var(--safe-bottom)+92px)] z-10 border-l-4 border-danger bg-canvas/95 py-1 pl-3 text-base font-medium text-alert">
          {error ?? '連線不穩，顯示的是上一次的狀態。'}
        </p>
      )}
    </>
  )
}
