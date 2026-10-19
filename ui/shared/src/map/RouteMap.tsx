import { useMap } from '@vis.gl/react-google-maps'
import { useEffect, type ReactNode } from 'react'
import type { BusStop, Place, PickupPoint, Route } from '../api/types'
import type { LatLng } from './config'
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
  /** Extra space kept free around the route, e.g. under a sheet that covers the map. */
  padding?: { top: number; right: number; bottom: number; left: number }
  className?: string
  /** E.g. a VehicleMarker. */
  children?: ReactNode
}

const DEFAULT_PADDING = { top: 56, right: 32, bottom: 32, left: 32 }

function FitBounds({ points, padding }: { points: LatLng[]; padding: RouteMapProps['padding'] }) {
  const map = useMap()
  const key = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';')
  useEffect(() => {
    if (!map || points.length === 0) return
    const bounds = new google.maps.LatLngBounds()
    points.forEach((p) => bounds.extend(p))
    map.fitBounds(bounds, padding ?? DEFAULT_PADDING)
    // `key` stands for the points; padding is fixed per screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

/** Pickup point, trip route, bus stops along it and destination, framed to fit (8.3 RouteMap). */
export function RouteMap({ pickup, destination, route, dropoffStopId = null, padding, className, children }: RouteMapProps) {
  const path = route ? decodePolyline(route.polyline) : []
  const stops: BusStop[] = route?.bus_stops ?? []
  const fit = [...path, ...(pickup ? [pickup] : []), ...(destination ? [destination] : [])]
  return (
    <MapView className={className}>
      <FitBounds points={fit} padding={padding} />
      {route && <RoutePolyline encodedPath={route.polyline} />}
      {stops.map((s) => (
        <PlaceMarker key={s.id} kind={s.id === dropoffStopId ? 'dropoff' : 'stop'} position={s} title={s.name} />
      ))}
      {destination && <PlaceMarker kind="destination" position={destination} title={destination.name} />}
      {pickup && <PlaceMarker kind="pickup" position={pickup} title={pickup.name} />}
      {children}
    </MapView>
  )
}
