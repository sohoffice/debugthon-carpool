import type { LatLng } from './config'

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

/**
 * The heading the backend computed; without one (a single report so far) the car keeps the old one.
 * The UI never works it out from positions itself (DD-31, UD-15).
 */
export function nextHeading(reported: number | null, previous: number): number {
  return reported ?? previous
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
