import { distanceM, type BusStop, type LatLng, type PassengerProfile, type PassengerSearch, type PickupPoint } from '@carpool/shared'

/** Habitual destination and stops prefill the search (REQ-025); filters start empty. */
export function searchFromProfile(profile: PassengerProfile | null): PassengerSearch | null {
  if (!profile?.usual_destination || profile.accepted_stops.length === 0) return null
  return { destination: profile.usual_destination, accepted_stop_ids: profile.accepted_stops.map((s) => s.id), tag_filters: [] }
}

/** GET /api/passenger/supply query string (T11, types.ts Supply). */
export function supplyQueryString(pickupPointId: number, search: PassengerSearch): string {
  const tagIds = (intent: string) => search.tag_filters.filter((f) => f.intent === intent).map((f) => f.tag_id).join(',')
  return new URLSearchParams({
    pickup_point_id: String(pickupPointId),
    dest_name: search.destination.name,
    dest_lat: String(search.destination.lat),
    dest_lng: String(search.destination.lng),
    stop_ids: search.accepted_stop_ids.join(','),
    required_tags: tagIds('required'),
    preferred_tags: tagIds('preferred'),
  }).toString()
}

/** Default pickup point: the nearest to where the passenger is (DD-26, REQ-029). */
export function nearestPickup(pickupPoints: PickupPoint[], position: LatLng | null): PickupPoint | null {
  if (!position || pickupPoints.length === 0) return pickupPoints[0] ?? null
  return pickupPoints.reduce((a, b) => (distanceM(a, position) <= distanceM(b, position) ? a : b))
}

/** Names of the accepted stops; both sides of a road share a name and show once. */
export function stopNames(busStops: BusStop[], ids: number[]): string[] {
  return [...new Set(busStops.filter((s) => ids.includes(s.id)).map((s) => s.name))]
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} 公尺` : `${(m / 1000).toFixed(1)} 公里`
}

/** Whole minutes for a board, never "0 分鐘". */
export function minutesOf(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60))
}
