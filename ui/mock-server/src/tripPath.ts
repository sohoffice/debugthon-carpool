import type { BusStop, PickupPoint, Route } from '../../shared/src/api/types.ts'
import { SPEED_MPS } from './config.ts'
import { mustGet, type Lookups } from './context.ts'
import { CORRIDORS, type Waypoint } from './corridors.ts'
import { distanceM, encodePolyline, makePath, type LatLng, type Path } from './geo.ts'

export interface TripPath {
  /** Approach + route, the line the car moves along. */
  path: Path
  /** Metres along `path` where the pickup point is. */
  pickupAlong: number
  route: Route
}

function resolve(lookups: Lookups, pickup: PickupPoint, waypoint: Waypoint): { point: LatLng; stop: BusStop | null } {
  if (waypoint === 'pickup') return { point: pickup, stop: null }
  if (typeof waypoint !== 'number') return { point: waypoint, stop: null }
  const point = mustGet(lookups.data.csvStops, waypoint, 'bus stop')
  return { point, stop: lookups.busStopByStopId.get(waypoint) ?? null }
}

/**
 * The car's line for a trip: the corridor into the pickup point, then the corridor onward,
 * cut where it comes closest to the destination, then straight to the destination.
 */
export function buildTripPath(lookups: Lookups, pickup: PickupPoint, destination: LatLng): TripPath {
  const corridor = CORRIDORS[pickup.name]
  if (!corridor) throw new Error(`No corridor for pickup point ${pickup.name}`)

  const approach = corridor.approach.map((w) => resolve(lookups, pickup, w).point)
  const onward = corridor.onward.map((w) => resolve(lookups, pickup, w))
  const cut = onward.reduce((best, w, i) => (i > 0 && distanceM(w.point, destination) < distanceM(onward[best].point, destination) ? i : best), 1)
  const kept = onward.slice(0, cut + 1)
  const routePoints = [...kept.map((w) => w.point), { lat: destination.lat, lng: destination.lng }]
  const routePath = makePath(routePoints)
  const approachPath = makePath(approach)

  return {
    path: makePath([...approach, ...routePoints.slice(1)]),
    pickupAlong: approachPath.length,
    route: {
      polyline: encodePolyline(routePoints),
      distance_m: Math.round(routePath.length),
      duration_s: Math.round(routePath.length / SPEED_MPS),
      simulated: true,
      bus_stops: kept.flatMap((w) => (w.stop ? [w.stop] : [])),
    },
  }
}
