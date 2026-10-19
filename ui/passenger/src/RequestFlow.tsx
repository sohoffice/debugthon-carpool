import { ApiError, usePolling, type LatLng, type PassengerRequest, type PassengerRequestResponse, type Ride } from '@carpool/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BoardedScreen } from './BoardedScreen'
import { api, POLL_INTERVAL_MS } from './config'
import { ConfirmedScreen } from './ConfirmedScreen'
import { MatchNotification } from './MatchNotification'
import { NoMatchScreen } from './NoMatchScreen'
import { ResultScreen } from './ResultScreen'
import { minutesOf } from './search'
import { useLocationReporting } from './useLocationReporting'
import { WaitingScreen } from './WaitingScreen'

const fetchRequest = () => api.get<PassengerRequestResponse>('/passenger/request')
const isOpen = (r: PassengerRequest) => r.status === 'waiting_driver' || r.status === 'confirmed' || r.status === 'boarded'
const withRide = (r: PassengerRequest): r is PassengerRequest & { ride: Ride } => r.ride !== null

interface RequestFlowProps {
  /** Just submitted, or the open request found on load. */
  initial: PassengerRequest
  /** Submitted in this session: a match right away still gets the notification. */
  fresh: boolean
  position: LatLng | null
  /** Back to the supply board, with an optional one-line notice. */
  onBack: (notice: string | null) => void
  /** Whether the request is still open, i.e. positions are being reported (debug mode shows it). */
  onOpenChange?: (open: boolean) => void
}

/** 7.4: follows the request by polling until it is over (REQ-053). */
export function RequestFlow({ initial, fresh, position, onBack, onOpenChange }: RequestFlowProps) {
  const [open, setOpen] = useState(isOpen(initial))
  const polling = usePolling(fetchRequest, POLL_INTERVAL_MS, open)
  const request = polling.data?.request?.id === initial.id ? polling.data.request : initial
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [celebrate, setCelebrate] = useState(false)
  const previous = useRef<PassengerRequest['status'] | null>(fresh ? 'waiting_driver' : initial.status)

  useEffect(() => setOpen(isOpen(request)), [request])
  useEffect(() => onOpenChange?.(open), [open, onOpenChange])
  useLocationReporting(position, isOpen(request))

  // The moment a car is matched: simulated notification and the one choreographed transition (UD-10, UD-12).
  useEffect(() => {
    if (request.status === 'confirmed' && previous.current === 'waiting_driver' && request.ride) {
      const eta = request.ride.eta_s === null ? '' : ` ${minutesOf(request.ride.eta_s)} 分鐘後到`
      setNotice(`${request.ride.vehicle.plate}${eta}${request.pickup_point.name}`)
      setCelebrate(true)
    }
    previous.current = request.status
  }, [request])

  useEffect(() => {
    if (request.status === 'cancelled') onBack('已取消請求')
  }, [request.status, onBack])

  async function act(action: 'cancel' | 'board' | 'complete') {
    setBusy(true)
    setError(null)
    try {
      polling.mutate(await api.post<PassengerRequestResponse>(`/passenger/requests/${request.id}/${action}`))
    } catch (err) {
      // The state moved on meanwhile, e.g. the car passed the pickup point: show it.
      if (err instanceof ApiError && err.status === 409) polling.mutate(await fetchRequest().catch(() => ({ request })))
      setError(err instanceof ApiError && err.status < 500 ? err.message : '沒有送出成功，請再按一次。')
    } finally {
      setBusy(false)
    }
  }

  const closeNotice = useCallback(() => setNotice(null), [])
  const back = () => onBack(null)

  let screen
  if (request.status === 'waiting_driver') {
    screen = <WaitingScreen request={request} busy={busy} onCancel={() => act('cancel')} />
  } else if (request.status === 'confirmed' && withRide(request)) {
    screen = <ConfirmedScreen request={request} celebrate={celebrate} busy={busy} onBoarded={() => act('board')} onCancel={() => act('cancel')} />
  } else if (request.status === 'boarded' && withRide(request)) {
    screen = <BoardedScreen request={request} busy={busy} onDone={() => act('complete')} />
  } else if (request.status === 'no_match') {
    screen = <NoMatchScreen request={request} onBack={back} />
  } else if (request.status === 'rejected') {
    screen = <ResultScreen title="還不能送出" text={request.reject_reason?.message ?? '離上車點太遠。'} action="回去看接近的車" onAction={back} />
  } else if (request.status === 'completed') {
    screen = <ResultScreen title="共乘完成" text="這趟共乘已記錄。路上少了一台車。" action="回到首頁" onAction={back} />
  } else {
    screen = null
  }

  return (
    <>
      {screen}
      {notice && <MatchNotification text={notice} onClose={closeNotice} />}
      {(error || polling.error) && (
        <p role="alert" className="absolute inset-x-6 bottom-[calc(var(--safe-bottom)+92px)] z-10 border-l-4 border-danger bg-white/95 py-1 pl-3 text-base font-medium text-danger">
          {error ?? '連線不穩，顯示的是上一次的狀態。'}
        </p>
      )}
    </>
  )
}
