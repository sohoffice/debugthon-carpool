import type { ReactNode } from 'react'
import type { BusStop, Place, PickupPoint, Route } from '../api/types'
import { FitBounds, type MapPadding } from './FitBounds'
import { MapView } from './MapView'
import { PlaceMarker } from './PlaceMarker'
import { decodePolyline } from './polyline'
import { RoutePolyline } from './RoutePolyline'

interface RouteMapProps {
  pickup: PickupPoint | null
  destination: Place | null
  route: Route | null
  /** The passenger's bus stop, drawn filled (8.3). */
  dropoffStopId?: number | null
  /** Other pickup points to show while choosing one; the map then frames them all. */
  pickupOptions?: PickupPoint[]
  /** Extra space kept free around the route, e.g. under a sheet that covers the map. */
  padding?: MapPadding
  className?: string
  /** False: a picture only (MapView). */
  interactive?: boolean
  /** E.g. a VehicleMarker. */
  children?: ReactNode
}

/** Pickup point, trip route, bus stops along it and destination, framed to fit (8.3 RouteMap). */
export function RouteMap({ pickup, destination, route, dropoffStopId = null, pickupOptions = [], padding, className, interactive, children }: RouteMapProps) {
  const path = route ? decodePolyline(route.polyline) : []
  const stops: BusStop[] = route?.bus_stops ?? []
  const options = pickupOptions.filter((p) => p.id !== pickup?.id)
  const fit = [...path, ...(pickup ? [pickup] : []), ...(destination ? [destination] : []), ...options]
  return (
    <MapView className={className} interactive={interactive}>
      <FitBounds points={fit} padding={padding} />
      {route && <RoutePolyline encodedPath={route.polyline} />}
      {stops.map((s) => (
        <PlaceMarker key={s.id} kind={s.id === dropoffStopId ? 'dropoff' : 'stop'} position={s} title={s.name} />
      ))}
      {destination && <PlaceMarker kind="destination" position={destination} title={destination.name} />}
      {options.map((p) => (
        <PlaceMarker key={p.id} kind="pickup-option" position={p} title={p.name} />
      ))}
      {pickup && <PlaceMarker kind="pickup" position={pickup} title={pickup.name} />}
      {children}
    </MapView>
  )
}
