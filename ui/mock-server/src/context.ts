import type { BusStop, PickupPoint } from '../../shared/src/api/types.ts'
import type { StaticData } from './data/load.ts'
import type { SeedTag, SeedUser } from './data/seed.ts'

/** Static lookups built once from the seed. */
export interface Lookups {
  data: StaticData
  users: SeedUser[]
  userByName: Map<string, SeedUser>
  userById: Map<number, SeedUser>
  pickupById: Map<number, PickupPoint>
  pickupByName: Map<string, PickupPoint>
  busStopById: Map<number, BusStop>
  /** Park bus stops by open-data stop id. */
  busStopByStopId: Map<number, BusStop>
  tagById: Map<number, SeedTag>
  tagByName: Map<string, SeedTag>
  settings: Record<string, number>
}

export function buildLookups(data: StaticData): Lookups {
  const { seed } = data
  return {
    data,
    users: seed.users,
    userByName: new Map(seed.users.map((u) => [u.username, u])),
    userById: new Map(seed.users.map((u) => [u.id, u])),
    pickupById: new Map(seed.pickupPoints.map((p) => [p.id, p])),
    pickupByName: new Map(seed.pickupPoints.map((p) => [p.name, p])),
    busStopById: new Map(seed.busStops.map((b) => [b.id, b])),
    busStopByStopId: new Map(seed.busStops.flatMap((b) => (b.stop_id === null ? [] : [[b.stop_id, b] as const]))),
    tagById: new Map(seed.tags.map((t) => [t.id, t])),
    tagByName: new Map(seed.tags.map((t) => [t.name, t])),
    settings: seed.settings,
  }
}

export function mustGet<K, V>(map: Map<K, V>, key: K, what: string): V {
  const value = map.get(key)
  if (value === undefined) throw new Error(`Mock data is missing ${what}: ${String(key)}`)
  return value
}
