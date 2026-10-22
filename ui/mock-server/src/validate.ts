import type { DepartureSettings, LatLngBody, PassengerSearch, Place, RoutePreviewRequest, TagFilter } from '../../shared/src/api/types.ts'
import type { Role } from '../../shared/src/api/client.ts'
import type { Lookups } from './context.ts'
import type { SeedTag } from './data/seed.ts'
import { MockError } from './errors.ts'
import type { Submission } from './operations.ts'
import { insidePark } from './park.ts'
import type { PassengerProfileState } from './world.ts'

const bad = (what: string) => new MockError(400, 'invalid_request', `請求格式錯誤：${what}`)
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function place(v: unknown): Place {
  if (!isObject(v) || typeof v.name !== 'string' || v.name.trim() === '' || !isNumber(v.lat) || !isNumber(v.lng)) throw bad('destination')
  return { name: v.name.trim(), lat: v.lat, lng: v.lng }
}

function parkPlace(v: unknown, lookups: Lookups): Place {
  const p = place(v)
  if (!insidePark(lookups, p)) throw new MockError(400, 'destination_outside_park', '目的地必須在內湖科學園區內')
  return p
}

/** Whether a tag applies to a side (DD-42). */
export const appliesTo = (tag: SeedTag, side: Role) => tag.applies_to === side || tag.applies_to === 'both'

/** Filters on the tags of `side`, the role being filtered (REQ-085, DD-42). */
function tagFilters(v: unknown, lookups: Lookups, side: Role): TagFilter[] {
  if (!Array.isArray(v)) throw bad('tag_filters')
  const filters = v.map((f): TagFilter => {
    if (!isObject(f) || !isNumber(f.tag_id) || (f.intent !== 'required' && f.intent !== 'preferred')) throw bad('tag_filters')
    return { tag_id: f.tag_id, intent: f.intent }
  })
  if (new Set(filters.map((f) => f.tag_id)).size !== filters.length) throw bad('tag_filters')
  const tags = filters.map((f) => lookups.tagById.get(f.tag_id))
  if (!tags.every((t) => t !== undefined)) throw new MockError(400, 'invalid_tag', '標籤不在清單中')
  if (!tags.every((t) => appliesTo(t, side))) throw new MockError(400, 'tag_not_applicable', '篩選條件只能使用適用於對方的標籤')
  return filters
}

function pickupPointId(v: unknown, lookups: Lookups): number {
  if (!isNumber(v)) throw bad('pickup_point_id')
  if (!lookups.pickupById.has(v)) throw new MockError(400, 'invalid_pickup_point', '上車點必須是預先定義的上車點之一')
  return v
}

function stops(v: unknown, lookups: Lookups): number[] {
  if (!Array.isArray(v) || !v.every(isNumber)) throw bad('stop_ids')
  if (!v.every((id) => lookups.busStopById.has(id))) throw new MockError(400, 'invalid_stop', '公車站不在清單中')
  return v
}

function latLng(v: unknown, what: string): LatLngBody {
  if (!isObject(v) || !isNumber(v.lat) || !isNumber(v.lng) || Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) {
    throw new MockError(400, 'invalid_location', `需要有效的 ${what}（lat -90～90、lng -180～180）`)
  }
  return { lat: v.lat, lng: v.lng }
}

/** Like the Go backend's preview: the destination needs only a position, no name. */
export function routePreviewRequest(body: unknown, lookups: Lookups): RoutePreviewRequest {
  if (!isObject(body)) throw bad('body')
  const pickup = pickupPointId(body.pickup_point_id, lookups)
  const d = body.destination
  if (!isObject(d) || !isNumber(d.lat) || !isNumber(d.lng)) throw bad('destination')
  const destination = { lat: d.lat, lng: d.lng }
  if (!insidePark(lookups, destination)) throw new MockError(400, 'destination_outside_park', '目的地必須在內湖科學園區內')
  return { pickup_point_id: pickup, destination }
}

/** GET /api/park/check?lat=&lng=, with the Go backend's checks. */
export function parkCheckQuery(query: URLSearchParams): LatLngBody {
  const lat = Number(query.get('lat') ?? 'x')
  const lng = Number(query.get('lng') ?? 'x')
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new MockError(400, 'invalid_location', '需要有效的 lat（-90～90）與 lng（-180～180）')
  }
  return { lat, lng }
}

/** Same checks and codes as the Go backend's depart. */
/** A driver's filters are on passenger tags and always required (REQ-013, DD-42). */
function driverFilters(v: unknown, lookups: Lookups): TagFilter[] {
  const filters = tagFilters(v, lookups, 'passenger')
  if (filters.some((f) => f.intent !== 'required')) throw new MockError(400, 'intent_not_allowed', '駕駛的標籤篩選只能是強制（required）')
  return filters
}

export function departureSettings(body: unknown, lookups: Lookups): DepartureSettings {
  if (!isObject(body)) throw bad('body')
  const { capacity } = body
  if (!isNumber(capacity) || !Number.isInteger(capacity) || capacity < 1) {
    throw new MockError(400, 'invalid_request', 'capacity 要大於 0')
  }
  return {
    pickup_point_id: pickupPointId(body.pickup_point_id, lookups),
    destination: parkPlace(body.destination, lookups),
    capacity,
    auto_accept: body.auto_accept === true,
    tag_filters: body.tag_filters === undefined ? [] : driverFilters(body.tag_filters, lookups),
    ...(body.preview_id === undefined ? {} : { preview_id: previewId(body.preview_id) }),
  }
}

function previewId(v: unknown): number {
  if (!isNumber(v) || !Number.isInteger(v)) throw bad('preview_id')
  return v
}

/**
 * Destination, stops and filters of a supply query or a request, like the Go backend: destination
 * and stops fall back to the passenger's habitual data (REQ-025).
 */
function passengerSearch(
  given: { destination?: unknown; stopIds?: unknown; tagFilters: TagFilter[] },
  lookups: Lookups,
  profile: PassengerProfileState | undefined,
): PassengerSearch {
  const destination = given.destination !== undefined ? place(given.destination) : profile?.destination
  if (!destination) throw new MockError(400, 'destination_required', '需要目的地')
  const ids = given.stopIds !== undefined ? stops(given.stopIds, lookups) : (profile?.acceptedStopIds ?? [])
  if (ids.length === 0) throw new MockError(400, 'stops_required', '至少選一個可以下車的公車站')
  return { destination, accepted_stop_ids: ids, tag_filters: given.tagFilters }
}

function idList(raw: string | null, what: string): number[] {
  if (raw === null || raw === '') return []
  const list = raw.split(',').map((x) => Number(x.trim()))
  if (!list.every(Number.isInteger)) throw bad(what)
  return list
}

/** GET /api/passenger/supply query (types.ts Supply). */
export function supplyQuery(query: URLSearchParams, lookups: Lookups, profile: PassengerProfileState | undefined): { pickupPointId: number; search: PassengerSearch } {
  const raw = query.get('pickup_point_id')
  if (raw === null || raw === '') throw bad('pickup_point_id')
  const pickupPointId = Number(raw)
  if (!Number.isInteger(pickupPointId)) throw bad('pickup_point_id')
  if (!lookups.pickupById.has(pickupPointId)) throw new MockError(400, 'invalid_pickup_point', '上車點必須是預先定義的上車點之一')
  const lat = query.get('dest_lat')
  const lng = query.get('dest_lng')
  const filters = tagFilters(
    [
      ...idList(query.get('required_tags'), 'required_tags').map((tag_id) => ({ tag_id, intent: 'required' })),
      ...idList(query.get('preferred_tags'), 'preferred_tags').map((tag_id) => ({ tag_id, intent: 'preferred' })),
    ],
    lookups,
    'driver',
  )
  const search = passengerSearch(
    {
      destination: lat === null && lng === null ? undefined : { name: query.get('dest_name') || '目的地', lat: Number(lat), lng: Number(lng) },
      stopIds: query.has('stop_ids') ? idList(query.get('stop_ids'), 'stop_ids') : undefined,
      tagFilters: filters,
    },
    lookups,
    profile,
  )
  return { pickupPointId, search }
}

/** Body of POST /api/passenger/requests (types.ts RequestSubmission). */
export function requestSubmission(body: unknown, lookups: Lookups, profile: PassengerProfileState | undefined): Submission {
  if (!isObject(body)) throw bad('body')
  const location = latLng(body.location, 'location')
  const pickupPoint = pickupPointId(body.pickup_point_id, lookups)
  const search = passengerSearch(
    { destination: body.destination, stopIds: body.stop_ids, tagFilters: body.tag_filters === undefined ? [] : tagFilters(body.tag_filters, lookups, 'driver') },
    lookups,
    profile,
  )
  return { pickupPointId: pickupPoint, location, search }
}

export function locationBody(body: unknown): LatLngBody {
  return latLng(body, 'lat 與 lng')
}

export function idParam(raw: string, what: string): number {
  if (!/^[+-]?\d+$/.test(raw)) throw new MockError(400, 'bad_request', `${what}編號格式錯誤`)
  return Number(raw)
}
