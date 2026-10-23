import { PlaceMarker, RouteMap, useMapAvailable, type DriverRequestItem, type TripView } from '@carpool/shared'
import { useEffect, useState } from 'react'
import { api } from './config'

interface RequestMapProps {
  tripId: number
  request: DriverRequestItem
}

/**
 * The one map while driving, only while a request waits for an answer (DD-04 exception, REQ-066):
 * pickup, the saved trip route (DD-21), the passenger's drop-off and the destination, no other
 * stops, not interactive. Nothing at all when the map or the trip cannot load.
 */
export function RequestMap({ tripId, request }: RequestMapProps) {
  const available = useMapAvailable()
  const [trip, setTrip] = useState<TripView | null>(null)

  useEffect(() => {
    if (!available) return
    let current = true
    api.get<TripView>(`/trips/${tripId}`).then((t) => current && setTrip(t), () => undefined)
    return () => {
      current = false
    }
  }, [tripId, available])

  if (!available || trip === null) return null
  const { dropoff } = request
  // The stop comes from the request, so the route's other stops are left out.
  const route = trip.route && { ...trip.route, bus_stops: [] }
  return (
    <RouteMap
      pickup={request.pickup_point}
      destination={trip.destination}
      route={route}
      interactive={false}
      padding={{ top: 48, right: 24, bottom: 24, left: 24 }}
    >
      {/* At the destination the destination's square is the drop-off (UD-29). */}
      {dropoff.bus_stop_id !== null && <PlaceMarker kind="dropoff" position={dropoff} title={dropoff.name} />}
    </RouteMap>
  )
}
