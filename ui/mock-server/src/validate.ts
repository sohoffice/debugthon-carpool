import type { DepartureSettings, PassengerSearch, Place, RoutePreviewRequest, TagFilter } from '../../shared/src/api/types.ts'
import type { Lookups } from './context.ts'
import { MockError } from './errors.ts'
import { insidePark } from './places.ts'

const MAX_CAPACITY = 8

const bad = (what: string) => new MockError(400, 'bad_request', `請求格式錯誤：${what}`)
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function place(v: unknown, lookups: Lookups): Place {
  if (!isObject(v) || typeof v.name !== 'string' || v.name.trim() === '' || !isNumber(v.lat) || !isNumber(v.lng)) throw bad('destination')
  const p = { name: v.name.trim(), lat: v.lat, lng: v.lng }
  if (!insidePark(lookups, p)) throw new MockError(422, 'destination_outside_park', '目的地要在內湖科技園區內')
  return p
}

function tagFilters(v: unknown, lookups: Lookups): TagFilter[] {
  if (!Array.isArray(v)) throw bad('tag_filters')
  return v.map((f) => {
    if (!isObject(f) || !isNumber(f.tag_id) || (f.intent !== 'required' && f.intent !== 'preferred')) throw bad('tag_filters')
    if (!lookups.tagById.has(f.tag_id)) throw new MockError(422, 'unknown_tag', '標籤不在清單中')
    return { tag_id: f.tag_id, intent: f.intent }
  })
}

function pickupPointId(v: unknown, lookups: Lookups): number {
  if (!isNumber(v)) throw bad('pickup_point_id')
  if (!lookups.pickupById.has(v)) throw new MockError(422, 'unknown_pickup_point', '上車點不在清單中')
  return v
}

export function routePreviewRequest(body: unknown, lookups: Lookups): RoutePreviewRequest {
  if (!isObject(body)) throw bad('body')
  return { pickup_point_id: pickupPointId(body.pickup_point_id, lookups), destination: place(body.destination, lookups) }
}

export function departureSettings(body: unknown, lookups: Lookups): DepartureSettings {
  if (!isObject(body)) throw bad('body')
  const { capacity } = body
  if (!isNumber(capacity) || !Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
    throw new MockError(422, 'invalid_capacity', `可載人數要在 1～${MAX_CAPACITY} 人之間`)
  }
  if (typeof body.auto_accept !== 'boolean') throw bad('auto_accept')
  return {
    pickup_point_id: pickupPointId(body.pickup_point_id, lookups),
    destination: place(body.destination, lookups),
    capacity,
    auto_accept: body.auto_accept,
    tag_filters: tagFilters(body.tag_filters, lookups),
  }
}

export function passengerSearch(body: unknown, lookups: Lookups): PassengerSearch {
  if (!isObject(body)) throw bad('body')
  const stops = body.accepted_stop_ids
  if (!Array.isArray(stops) || !stops.every(isNumber)) throw bad('accepted_stop_ids')
  if (stops.length === 0) throw new MockError(422, 'no_accepted_stops', '至少選一個可以下車的公車站')
  if (!stops.every((id) => lookups.busStopById.has(id))) throw new MockError(422, 'unknown_bus_stop', '公車站不在清單中')
  return { destination: place(body.destination, lookups), accepted_stop_ids: stops, tag_filters: tagFilters(body.tag_filters, lookups) }
}

export function idParam(raw: string, what: string): number {
  if (!/^[+-]?\d+$/.test(raw)) throw new MockError(400, 'bad_request', `${what}編號格式錯誤`)
  return Number(raw)
}
