import type { CityHistory, CityLive, CityToday } from '@carpool/shared'

export interface PickupRow {
  id: number
  name: string
  waiting: number | null
  completedToday: number | null
  drivers: number
  passengers: number
  rides: number
  /** Passengers minus rides per day: who did not get a ride (DD-37). */
  missed: number
  /** The pickup point with the most missed passengers: drivers are short there (REQ-080). */
  worst: boolean
}

/** One row per pickup point, joining the history averages with live waiting and today's rides by id. */
export function pickupRows(history: CityHistory, live: CityLive | undefined, today: CityToday | undefined): PickupRow[] {
  const rows = history.pickup_points.map((p) => ({
    id: p.id,
    name: p.name,
    waiting: live?.pickup_points.find((l) => l.id === p.id)?.waiting ?? null,
    completedToday: today?.pickup_points.find((t) => t.id === p.id)?.completed ?? null,
    drivers: p.drivers_per_day,
    passengers: p.passengers_per_day,
    rides: p.rides_per_day,
    // Both are rounded to one decimal; round the difference again to drop float noise.
    missed: Math.round((p.passengers_per_day - p.rides_per_day) * 10) / 10,
    worst: false,
  }))
  const most = Math.max(...rows.map((r) => r.missed))
  return rows.map((r) => ({ ...r, worst: most > 0 && r.missed === most }))
}
