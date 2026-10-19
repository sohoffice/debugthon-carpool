import type { BusStop } from '../api/types'

export type RouteStripKind = 'pickup' | 'stop' | 'dropoff' | 'destination'

export interface RouteStripItem {
  key: string
  name: string
  kind: RouteStripKind
  /** Right-hand label, e.g. 上車, 下車, 終點. */
  note?: string
}

interface BuildOptions {
  /** Bus stop where the passenger gets off; marked as a filled circle (8.3). */
  dropoffStopId?: number | null
  /** Intermediate stops to show at most; others are skipped like a line map shows main stations. */
  maxStops?: number
}

/**
 * Route strip rows for pickup → bus stops → destination. A name is shown once along the route
 * (both sides of a road, or a stop the route passes twice); the passenger's stop wins over a
 * namesake. Returns how many stops were left out, so the screen can say so.
 */
export function routeStripItems(
  pickupName: string,
  stops: BusStop[],
  destinationName: string,
  { dropoffStopId = null, maxStops = 3 }: BuildOptions = {},
): { items: RouteStripItem[]; hidden: number } {
  const dropoffName = stops.find((s) => s.id === dropoffStopId)?.name
  const seen = new Set<string>()
  const unique = stops.filter((s) => {
    if (s.id === dropoffStopId) return true
    if (s.name === dropoffName || seen.has(s.name)) return false
    seen.add(s.name)
    return true
  })
  const dropoffIndex = unique.findIndex((s) => s.id === dropoffStopId)
  const keep = new Set<number>()
  if (unique.length <= maxStops) {
    unique.forEach((_, i) => keep.add(i))
  } else {
    if (dropoffIndex >= 0) keep.add(dropoffIndex)
    for (let k = 1; keep.size < maxStops && k <= maxStops; k++) {
      keep.add(Math.round((k * (unique.length + 1)) / (maxStops + 1)) - 1)
    }
  }
  const shown = unique.filter((_, i) => keep.has(i))
  return {
    items: [
      { key: 'pickup', name: pickupName, kind: 'pickup', note: '上車' },
      ...shown.map((s): RouteStripItem => (s.id === dropoffStopId ? { key: `s${s.id}`, name: s.name, kind: 'dropoff', note: '下車' } : { key: `s${s.id}`, name: s.name, kind: 'stop' })),
      { key: 'destination', name: destinationName, kind: 'destination', note: '終點' },
    ],
    hidden: unique.length - shown.length,
  }
}
