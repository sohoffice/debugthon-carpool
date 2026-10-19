export interface LatLng {
  lat: number
  lng: number
}

const EARTH_RADIUS_M = 6371000
const rad = (deg: number) => (deg * Math.PI) / 180

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** Degrees clockwise from north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** A polyline with cumulative distances, for moving along it at a speed. */
export interface Path {
  points: LatLng[]
  /** cumulative[i] = distance from points[0] to points[i]. */
  cumulative: number[]
  length: number
}

export function makePath(points: LatLng[]): Path {
  const cumulative = points.reduce<number[]>(
    (acc, p, i) => [...acc, i === 0 ? 0 : acc[i - 1] + distanceM(points[i - 1], p)],
    [],
  )
  return { points, cumulative, length: cumulative[cumulative.length - 1] ?? 0 }
}

/** Position and heading at `along` metres from the start (clamped to the path). */
export function pointAlong(path: Path, along: number): { position: LatLng; heading: number } {
  const d = Math.min(Math.max(along, 0), path.length)
  let i = 1
  while (i < path.points.length - 1 && path.cumulative[i] < d) i++
  const a = path.points[i - 1]
  const b = path.points[i]
  const segment = path.cumulative[i] - path.cumulative[i - 1]
  const t = segment === 0 ? 0 : (d - path.cumulative[i - 1]) / segment
  return {
    position: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
    heading: bearingDeg(a, b),
  }
}

/** Google encoded polyline format, so the UI handles the mock like the Routes API output. */
export function encodePolyline(points: LatLng[]): string {
  let lastLat = 0
  let lastLng = 0
  let out = ''
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5)
    const lng = Math.round(p.lng * 1e5)
    out += encodeValue(lat - lastLat) + encodeValue(lng - lastLng)
    lastLat = lat
    lastLng = lng
  }
  return out
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let out = ''
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  return out + String.fromCharCode(v + 63)
}

/** Ray casting; ring is [lng, lat] pairs like GeoJSON. */
export function insidePolygon(p: LatLng, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
