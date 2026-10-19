import type {
  DepartureSettings,
  LatLngBody,
  PassengerSearch,
  Place,
  RequestSubmission,
  RoutePreviewRequest,
  SupplyQuery,
  TagFilter,
} from '../../shared/src/api/types.ts'
import type { Lookups } from './context.ts'
import { MockError } from './errors.ts'
import { insidePark } from './places.ts'

const bad = (what: string) => new MockError(400, 'bad_request', `請求格式錯誤：${what}`)
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function place(v: unknown, lookups: Lookups): Place {
  if (!isObject(v) || typeof v.name !== 'string' || v.name.trim() === '' || !isNumber(v.lat) || !isNumber(v.lng)) throw bad('destination')
  const p = { name: v.name.trim(), lat: v.lat, lng: v.lng }
  if (!insidePark(lookups, p)) throw new MockError(400, 'destination_outside_park', '目的地必須在內湖科學園區內')
  return p
}

function tagFilters(v: unknown, lookups: Lookups): TagFilter[] {
  if (!Array.isArray(v)) throw bad('tag_filters')
  const filters = v.map((f): TagFilter => {
    if (!isObject(f) || !isNumber(f.tag_id) || (f.intent !== 'required' && f.intent !== 'preferred')) throw bad('tag_filters')
    return { tag_id: f.tag_id, intent: f.intent }
  })
  if (new Set(filters.map((f) => f.tag_id)).size !== filters.length) throw bad('tag_filters')
  if (!filters.every((f) => lookups.tagById.has(f.tag_id))) throw new MockError(400, 'invalid_tag', '標籤不在清單中')
  return filters
}

function pickupPointId(v: unknown, lookups: Lookups): number {
  if (!isNumber(v)) throw bad('pickup_point_id')
  if (!lookups.pickupById.has(v)) throw new MockError(400, 'invalid_pickup_point', '上車點必須是預先定義的上車點之一')
  return v
}

function stops(v: unknown, lookups: Lookups): number[] {
  if (!Array.isArray(v) || !v.every(isNumber)) throw bad('accepted_stop_ids')
  if (v.length === 0) throw new MockError(400, 'no_accepted_stops', '至少選一個可以下車的公車站')
  if (!v.every((id) => lookups.busStopById.has(id))) throw new MockError(400, 'unknown_bus_stop', '公車站不在清單中')
  return v
}

function latLng(v: unknown, what: string): LatLngBody {
  if (!isObject(v) || !isNumber(v.lat) || !isNumber(v.lng) || Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) {
    throw new MockError(400, 'invalid_location', `需要有效的 ${what}（lat -90～90、lng -180～180）`)
  }
  return { lat: v.lat, lng: v.lng }
}

export function routePreviewRequest(body: unknown, lookups: Lookups): RoutePreviewRequest {
  if (!isObject(body)) throw bad('body')
  return { pickup_point_id: pickupPointId(body.pickup_point_id, lookups), destination: place(body.destination, lookups) }
}

/** Same checks and codes as the Go backend's depart. */
export function departureSettings(body: unknown, lookups: Lookups): DepartureSettings {
  if (!isObject(body)) throw bad('body')
  const { capacity } = body
  if (!isNumber(capacity) || !Number.isInteger(capacity) || capacity < 1) {
    throw new MockError(400, 'invalid_request', 'capacity 要大於 0')
  }
  return {
    pickup_point_id: pickupPointId(body.pickup_point_id, lookups),
    destination: place(body.destination, lookups),
    capacity,
    auto_accept: body.auto_accept === true,
    tag_filters: body.tag_filters === undefined ? [] : tagFilters(body.tag_filters, lookups),
  }
}

function passengerSearch(body: Record<string, unknown>, lookups: Lookups): PassengerSearch {
  return { destination: place(body.destination, lookups), accepted_stop_ids: stops(body.accepted_stop_ids, lookups), tag_filters: tagFilters(body.tag_filters, lookups) }
}

const ids = (raw: string | null) => (raw ? raw.split(',').map((x) => Number(x.trim())) : [])

/** GET /api/passenger/supply query (types.ts SupplyQuery). */
export function supplyQuery(query: URLSearchParams, lookups: Lookups): SupplyQuery {
  const number = (key: string) => (query.get(key) === null || query.get(key) === '' ? Number.NaN : Number(query.get(key)))
  const filters = [
    ...ids(query.get('required_tag_ids')).map((tag_id) => ({ tag_id, intent: 'required' })),
    ...ids(query.get('preferred_tag_ids')).map((tag_id) => ({ tag_id, intent: 'preferred' })),
  ]
  return {
    pickup_point_id: pickupPointId(number('pickup_point_id'), lookups),
    ...passengerSearch(
      {
        destination: { name: query.get('destination_name') ?? '', lat: number('destination_lat'), lng: number('destination_lng') },
        accepted_stop_ids: ids(query.get('accepted_stop_ids')),
        tag_filters: filters,
      },
      lookups,
    ),
  }
}

export function requestSubmission(body: unknown, lookups: Lookups): RequestSubmission {
  if (!isObject(body)) throw bad('body')
  return { pickup_point_id: pickupPointId(body.pickup_point_id, lookups), ...passengerSearch(body, lookups), location: latLng(body.location, 'location') }
}

export function locationBody(body: unknown): LatLngBody {
  return latLng(body, 'lat 與 lng')
}

export function idParam(raw: string, what: string): number {
  if (!/^[+-]?\d+$/.test(raw)) throw new MockError(400, 'bad_request', `${what}編號格式錯誤`)
  return Number(raw)
}
