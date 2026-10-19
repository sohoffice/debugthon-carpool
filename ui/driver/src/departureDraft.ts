import type { DepartureSettings, DriverProfile, Place, TagFilter, TripDefaults } from '@carpool/shared'
import { CAPACITY_RANGE } from './config'

export interface DepartureDraft {
  pickupPointId: number | null
  destination: Place | null
  capacity: number
  autoAccept: boolean
  tagFilters: TagFilter[]
}

/** True when the driver departed before, so the last settings can be reused (REQ-016). */
export function hasDefaults(defaults: TripDefaults | null): defaults is TripDefaults & { pickup_point_id: number; destination: Place } {
  return defaults !== null && defaults.pickup_point_id !== null && defaults.destination !== null
}

/** Prefill from the last departure, else from the habitual profile, else empty (REQ-016, UD-02). */
export function draftFrom(defaults: TripDefaults | null, profile: DriverProfile | null): DepartureDraft {
  if (hasDefaults(defaults)) {
    return {
      pickupPointId: defaults.pickup_point_id,
      destination: defaults.destination,
      capacity: defaults.capacity ?? CAPACITY_RANGE.fallback,
      autoAccept: defaults.auto_accept,
      tagFilters: defaults.tag_filters.map(({ tag_id, intent }) => ({ tag_id, intent })),
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
