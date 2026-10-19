import type { Alternative, PassengerSearch, PickupPoint } from '../../shared/src/api/types.ts'
import { BUS_SPEED_MPS, BUS_WAIT_S, WALK_SPEED_MPS, WALK_VIA } from './config.ts'
import type { Lookups } from './context.ts'
import type { CsvStop } from './data/load.ts'
import { distanceM, type LatLng } from './geo.ts'

const BOARD_RADIUS_M = 250
const ALIGHT_RADIUS_M = 300
/** Streets are not straight lines. */
const DETOUR = 1.3
const MAX_BUS_OPTIONS = 2

const minutes = (s: number) => Math.ceil(s / 60)

/**
 * Bus and walking alternatives when no car is available (REQ-051), from real Taipei bus routes
 * (docs/data/busstop). Times are estimates and marked simulated (REQ-063).
 */
export function findAlternatives(lookups: Lookups, pickup: PickupPoint, search: PassengerSearch): Alternative[] {
  const { csvStops, busRoutes } = lookups.data
  const acceptedOpenIds = new Set(
    search.accepted_stop_ids.flatMap((id) => {
      const stopId = lookups.busStopById.get(id)?.stop_id
      return stopId == null ? [] : [stopId]
    }),
  )
  const near = (id: number, p: LatLng, r: number) => {
    const s = csvStops.get(id)
    return s !== undefined && distanceM(s, p) <= r
  }

  const best = new Map<string, Alternative & { mode: 'bus' }>()
  for (const route of busRoutes) {
    const board = route.stopIds.findIndex((id) => near(id, pickup, BOARD_RADIUS_M))
    if (board < 0) continue
    for (let j = board + 1; j < route.stopIds.length; j++) {
      const id = route.stopIds[j]
      if (!acceptedOpenIds.has(id) && !near(id, search.destination, ALIGHT_RADIUS_M)) continue
      const stops = route.stopIds.slice(board, j + 1).map((s) => csvStops.get(s)).filter((s): s is CsvStop => s !== undefined)
      const rideM = stops.slice(1).reduce((sum, s, i) => sum + distanceM(stops[i], s), 0)
      const walkM = distanceM(stops[stops.length - 1], search.destination) * DETOUR
      const durationMin = minutes(BUS_WAIT_S + rideM / BUS_SPEED_MPS + walkM / WALK_SPEED_MPS)
      const previous = best.get(route.name)
      if (!previous || durationMin < previous.duration_min) {
        best.set(route.name, {
          mode: 'bus',
          route_name: route.name,
          board_stop_name: stops[0].name,
          alight_stop_name: stops[stops.length - 1].name,
          duration_min: durationMin,
          simulated: true,
        })
      }
      break
    }
  }

  const bus = [...best.values()].sort((a, b) => a.duration_min - b.duration_min).slice(0, MAX_BUS_OPTIONS)
  const walk: Alternative = {
    mode: 'walk',
    via: WALK_VIA[pickup.name] ?? null,
    duration_min: minutes((distanceM(pickup, search.destination) * DETOUR) / WALK_SPEED_MPS),
    simulated: true,
  }
  return [...bus, walk]
}
