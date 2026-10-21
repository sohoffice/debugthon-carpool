import type { DriverRequests, TripView } from '@carpool/shared'
import { useEffect, useRef, useState } from 'react'
import { api } from './config'

/**
 * 自動接受 (DD-33, REQ-022): on a trip departed with auto-accept on, a request waiting for this
 * driver is confirmed through the same API as the 確認 button. The backend does not confirm by
 * itself, so this is the only place an auto-accept happens for a trip driven from this UI.
 * `confirm` resolves false when the call failed and the next poll should try again.
 */
export function useAutoAccept(data: DriverRequests | undefined, confirm: (requestId: number) => Promise<boolean>) {
  const tripId = data?.trip_id ?? null
  // DriverRequests does not say whether the trip auto-accepts; the trip itself does.
  const [trip, setTrip] = useState<{ id: number; autoAccept: boolean } | null>(null)
  const lookingUp = useRef<number | null>(null)
  const sent = useRef(new Set<number>())

  // An ended trip is forgotten: the mock backend numbers trips and requests from 1 again after a
  // Demo reset, so a new manual trip could otherwise pass for the old auto-accept one.
  useEffect(() => {
    if (tripId !== null) return
    setTrip(null)
    sent.current.clear()
  }, [tripId])

  // Runs on every poll, so a failed lookup is tried again.
  useEffect(() => {
    if (tripId === null || trip?.id === tripId || lookingUp.current === tripId) return
    lookingUp.current = tripId
    api
      .get<TripView>(`/trips/${tripId}`)
      .then((t) => setTrip({ id: t.id, autoAccept: t.auto_accept }), () => undefined)
      .finally(() => (lookingUp.current = null))
  }, [tripId, trip, data])

  const waitingId = trip?.autoAccept && trip.id === tripId ? data?.pending[0]?.id : undefined
  useEffect(() => {
    if (waitingId === undefined || sent.current.has(waitingId)) return
    sent.current.add(waitingId)
    confirm(waitingId).then((ok) => {
      if (!ok) sent.current.delete(waitingId)
    })
    // `data` changes on every poll, which retries a confirm that failed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingId, data])
}
