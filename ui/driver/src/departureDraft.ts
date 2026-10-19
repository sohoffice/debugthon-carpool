import type { DepartureSettings, DriverProfile, DriverTrip, Place, TagFilter } from '@carpool/shared'
import { CAPACITY_RANGE } from './config'

export interface DepartureDraft {
  pickupPointId: number | null
  destination: Place | null
  capacity: number
  autoAccept: boolean
  tagFilters: TagFilter[]
}

/** Prefill from the last trip, else from the habitual profile, else empty (REQ-016, UD-02). */
export function draftFrom(lastTrip: DriverTrip | null, profile: DriverProfile | null): DepartureDraft {
  if (lastTrip) {
    return {
      pickupPointId: lastTrip.pickup_point.id,
      destination: lastTrip.destination,
      capacity: lastTrip.capacity,
      autoAccept: lastTrip.auto_accept,
      tagFilters: lastTrip.tag_filters,
    }
  }
  return {
    pickupPointId: profile?.usual_pickup_point?.id ?? null,
    destination: profile?.usual_destination ?? null,
    capacity: profile?.capacity ?? CAPACITY_RANGE.fallback,
    autoAccept: false,
    tagFilters: [],
  }
}

export function toSettings(draft: DepartureDraft): DepartureSettings | null {
  if (draft.pickupPointId === null || draft.destination === null) return null
  return {
    pickup_point_id: draft.pickupPointId,
    destination: draft.destination,
    capacity: draft.capacity,
    auto_accept: draft.autoAccept,
    tag_filters: draft.tagFilters,
  }
}
