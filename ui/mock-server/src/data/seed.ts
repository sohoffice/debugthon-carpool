import type { BusStop, PickupPoint, TagSide, Vehicle } from '../../../shared/src/api/types.ts'
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
  /** The side the tag applies to and its wording per side and use; null where it does not apply (DD-42). */
  applies_to: TagSide
  driver_self_label: string | null
  driver_filter_label: string | null
  passenger_self_label: string | null
  passenger_filter_label: string | null
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
  /** By driver username. */
  vehicles: Record<string, Vehicle>
  /** The Demo drivers' starting points (DD-34): `rows` seed rows of `delta` each, by driver username. */
  seedPoints: { username: string; rows: number; delta: number }[]
  settings: Record<string, number>
}

export interface SeedSql {
  schema: string
  users: string
  reference: string
  activities: string
  passMargin: string
  points: string
  tagRoles: string
  /** All migrations' Up parts in order, for the later moves of driver2's destination (T03, T23). */
  migrationsUp: string
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
  // DD-42: a tag missing from the wording list was dropped, and its id is not reused.
  const roles = new Map(valuesAfter(sql.tagRoles, 'UPDATE tags t', ') v (').map(([name, ...rest]) => [String(name), rest]))
  const label = (v: unknown) => (v === null ? null : String(v))
  const tags = valuesAfter(sql.reference, 'INSERT INTO tags', ';').flatMap(([name, issuer], i) => {
    const role = roles.get(String(name))
    if (!role) return []
    const [appliesTo, ds, df, ps, pf] = role
    return [{
      id: i + 1,
      name: String(name),
      issuer: String(issuer),
      applies_to: String(appliesTo) as TagSide,
      driver_self_label: label(ds),
      driver_filter_label: label(df),
      passenger_self_label: label(ps),
      passenger_filter_label: label(pf),
    }]
  })
  // REQ-008: a user keeps only the tags that apply to one of their roles.
  const applies = (username: string, tagName: string) => {
    const user = users.find((u) => u.username === username)
    const tag = tags.find((t) => t.name === tagName)
    if (!user || !tag) return false
    return (user.is_driver && tag.applies_to !== 'passenger') || (user.is_passenger && tag.applies_to !== 'driver')
  }
  const userTags = valuesAfter(sql.reference, 'INSERT INTO user_tags', ') v (')
    .map(([username, tag]) => ({ username: String(username), tag: String(tag) }))
    .filter((ut) => applies(ut.username, ut.tag))
  // The last UPDATE of driver2's trip destination wins, as on a database migrated to the latest version.
  const moves = sql.migrationsUp
    .split(';')
    .filter((statement) => statement.includes('UPDATE trips SET destination_name') && statement.includes("'driver2'"))
    .map((statement) => /destination_name = '([^']+)', destination_lat = ([\d.]+), destination_lng = ([\d.]+)/.exec(statement))
  const moved = moves.at(-1)
  if (!moved) throw new Error('no move of driver2’s destination found in the migrations')
  const simulatedTrips = valuesAfter(sql.reference, 'INSERT INTO trips', ') v (').map(([username, name, lat, lng, capacity]) => ({
    username: String(username),
    destination:
      username === 'driver2'
        ? { name: moved[1], lat: Number(moved[2]), lng: Number(moved[3]) }
        : { name: String(name), lat: Number(lat), lng: Number(lng) },
    capacity: Number(capacity),
  }))
  const vehicles = Object.fromEntries(
    valuesAfter(sql.activities, 'INSERT INTO vehicles', ') v (').map(([username, plate, description]) => [
      String(username),
      { plate: String(plate), description: String(description) },
    ]),
  )
  // Later migrations may renumber plates; the last UPDATE per driver wins.
  for (const [, plate, username] of sql.migrationsUp.matchAll(
    /UPDATE vehicles SET plate = '([^']+)' WHERE user_id = \(SELECT id FROM users WHERE username = '([^']+)'\)/g,
  )) {
    if (vehicles[username]) vehicles[username].plate = plate
  }
  // seed_demo_driver_points(): every seed row is worth the same delta.
  const seedDelta = /SELECT u\.id, (\d+), 'seed'/.exec(sql.points)
  if (!seedDelta) throw new Error('Seed SQL changed: no seed point delta in the points migration')
  const seedPoints = valuesAfter(sql.points, 'JOIN (VALUES', ') s (').map(([username, rows]) => ({
    username: String(username),
    rows: Number(rows),
    delta: Number(seedDelta[1]),
  }))
  const settings = Object.fromEntries(
    [
      ...valuesAfter(sql.schema, 'INSERT INTO system_settings', ';'),
      ...valuesAfter(sql.passMargin, 'INSERT INTO system_settings', ';'),
      ...valuesAfter(sql.points, 'INSERT INTO system_settings', ';'),
    ].map(([key, value]) => [String(key), Number(value)]),
  )
  return { users, pickupPoints, busStops, tags, userTags, simulatedTrips, vehicles, seedPoints, settings }
}
