import type { Lookups } from './context.ts'
import { insidePolygon, type LatLng } from './geo.ts'

/** The same park boundary as the Go backend (DD-32). */
export function insidePark(lookups: Lookups, point: LatLng): boolean {
  return insidePolygon(point, lookups.data.parkRing)
}
