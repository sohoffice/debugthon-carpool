import type { LatLng } from './config'
import { distanceM } from './vehicleMotion'

const M_PER_DEG_LAT = 111320
const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * The part of `shape` within `halfM` metres, measured along it, of the shape's point nearest to
 * `at`, in the shape's order (the direction of travel). Null when that leaves fewer than two points.
 */
export function pathAround(at: LatLng, shape: LatLng[], halfM: number): LatLng[] | null {
  if (shape.length < 2) return null
  const along = shape.reduce<number[]>((acc, p, i) => [...acc, i === 0 ? 0 : acc[i - 1] + distanceM(shape[i - 1], p)], [])
  const nearest = shape.reduce((best, p, i) => (distanceM(p, at) < distanceM(shape[best], at) ? i : best), 0)
  const path = shape.filter((_, i) => Math.abs(along[i] - along[nearest]) <= halfM)
  return path.length >= 2 ? path : null
}

/** A straight line `lengthM` long centred on `at`, heading `bearingDeg` (0 north, 90 east). */
export function pathAlongBearing(at: LatLng, bearingDeg: number, lengthM: number): LatLng[] {
  const half = lengthM / 2
  const dLat = (Math.cos(rad(bearingDeg)) * half) / M_PER_DEG_LAT
  const dLng = (Math.sin(rad(bearingDeg)) * half) / (M_PER_DEG_LAT * Math.cos(rad(at.lat)))
  return [
    { lat: at.lat - dLat, lng: at.lng - dLng },
    { lat: at.lat + dLat, lng: at.lng + dLng },
  ]
}
