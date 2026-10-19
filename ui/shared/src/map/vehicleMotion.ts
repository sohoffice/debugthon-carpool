import type { LatLng } from './config'

/** Moves shorter than this keep the old heading, so GPS noise at a red light does not spin the car (UD-15). */
export const MIN_HEADING_MOVE_M = 5
/** Farther jumps, or this many missed polls, are drawn as a jump, not a line through buildings. */
export const MAX_ANIMATED_MOVE_M = 300
export const MAX_MISSED_POLLS = 3

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

/** The API's heading, else the direction of travel, else the old heading when barely moved. */
export function nextHeading(from: LatLng, to: LatLng, reported: number | null, previous: number): number {
  if (reported !== null) return reported
  return distanceM(from, to) < MIN_HEADING_MOVE_M ? previous : bearingDeg(from, to)
}

/** Signed turn in degrees, always the shorter way round: 350 → 10 is +20, not −340. */
export function shortestTurn(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

export function shouldJump(from: LatLng, to: LatLng, missedPolls: number): boolean {
  return distanceM(from, to) > MAX_ANIMATED_MOVE_M || missedPolls >= MAX_MISSED_POLLS
}

export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
}
