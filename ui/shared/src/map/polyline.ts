import type { LatLng } from './config'

/** Decodes a Google encoded polyline (trips.route_polyline), e.g. to fit the map to a route. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  const next = () => {
    let result = 0
    let shift = 0
    let byte = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < encoded.length)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (index < encoded.length) {
    lat += next()
    lng += next()
    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points
}
