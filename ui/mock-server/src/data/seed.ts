import type { BusStop, PickupPoint } from '../../../shared/src/api/types.ts'
import { valuesAfter } from './sql.ts'

export interface SeedUser {
  id: number
  username: string
  display_name: string
  is_driver: boolean
  is_passenger: boolean
  simulated: boolean
}

export interface SeedTag {
  id: number
  name: string
  issuer: string
}

export interface SeedTrip {
  username: string
  destination: { name: string; lat: number; lng: number }
  capacity: number
}

export interface Seed {
  users: SeedUser[]
  pickupPoints: PickupPoint[]
  busStops: BusStop[]
  tags: SeedTag[]
  userTags: { username: string; tag: string }[]
  simulatedTrips: SeedTrip[]
  settings: Record<string, number>
}

export interface SeedSql {
  schema: string
  users: string
  reference: string
}

/**
 * Builds the mock data from the Go backend's migrations, so both backends start from the same
 * seed (UD-14). Ids follow insertion order, as bigserial does on a fresh database.
 */
export function parseSeed(sql: SeedSql): Seed {
  const users = valuesAfter(sql.users, 'INSERT INTO users', ';').map(([username, display_name, is_driver, is_passenger, simulated], i) => ({
    id: i + 1,
    username: String(username),
    display_name: String(display_name),
    is_driver: Boolean(is_driver),
    is_passenger: Boolean(is_passenger),
    simulated: Boolean(simulated),
  }))
  const pickupPoints = valuesAfter(sql.reference, 'INSERT INTO pickup_points', ';').map(([name, lat, lng, radius], i) => ({
    id: i + 1,
    name: String(name),
    lat: Number(lat),
    lng: Number(lng),
    radius_m: Number(radius),
  }))
  const busStops = valuesAfter(sql.reference, 'INSERT INTO bus_stops', ';').map(([stopId, name, lat, lng], i) => ({
    id: i + 1,
    stop_id: stopId === null ? null : Number(stopId),
    name: String(name),
    lat: Number(lat),
    lng: Number(lng),
  }))
  const tags = valuesAfter(sql.reference, 'INSERT INTO tags', ';').map(([name, issuer], i) => ({
    id: i + 1,
    name: String(name),
    issuer: String(issuer),
  }))
  const userTags = valuesAfter(sql.reference, 'INSERT INTO user_tags', ') v (').map(([username, tag]) => ({
    username: String(username),
    tag: String(tag),
  }))
  const simulatedTrips = valuesAfter(sql.reference, 'INSERT INTO trips', ') v (').map(([username, name, lat, lng, capacity]) => ({
    username: String(username),
    destination: { name: String(name), lat: Number(lat), lng: Number(lng) },
    capacity: Number(capacity),
  }))
  const settings = Object.fromEntries(
    valuesAfter(sql.schema, 'INSERT INTO system_settings', ';').map(([key, value]) => [String(key), Number(value)]),
  )
  return { users, pickupPoints, busStops, tags, userTags, simulatedTrips, settings }
}
