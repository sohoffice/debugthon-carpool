import type { Me, MockScenario, MockStatus } from '../../shared/src/api/types.ts'
import { SCENARIOS } from './config.ts'
import { buildLookups } from './context.ts'
import type { StaticData } from './data/load.ts'
import type { SeedUser } from './data/seed.ts'
import { MockError } from './errors.ts'
import {
  accept,
  boardRide,
  cancelRequest,
  completeRide,
  declareActivity,
  decline,
  depart,
  driverBoardRide,
  driverCompleteRide,
  reportLocation,
  submitRequest,
  tick,
} from './operations.ts'
import { buildPlaces, searchPlaces } from './places.ts'
import { buildTripPath } from './tripPath.ts'
import { departureSettings, idParam, locationBody, requestSubmission, routePreviewRequest, supplyQuery } from './validate.ts'
import {
  driverProfileView,
  driverTripView,
  passengerProfileView,
  passengerRequestView,
  supplyView,
  tagsView,
  tripDefaultsView,
  tripView,
} from './views.ts'
import { activeTripOf, findTrip, initialWorld, latestActivityOf, latestTripOf, requireRequest, type World } from './world.ts'

export interface MockRequest {
  method: string
  path: string
  query: URLSearchParams
  authorization: string | undefined
  body: unknown
}

export interface MockResponse {
  status: number
  body?: unknown
}

type Role = 'driver' | 'passenger'
type Access = 'public' | 'any' | Role

interface Call {
  user: SeedUser
  role: Role
  params: string[]
  body: unknown
  query: URLSearchParams
}

interface Endpoint {
  method: string
  /** Path segments; `:` marks a parameter. */
  pattern: string
  access: Access
  run: (call: Call) => MockResponse
}

const MAX_ADVANCE_S = 3600
const ok = (body: unknown): MockResponse => ({ status: 200, body })
const created = (body: unknown): MockResponse => ({ status: 201, body })
const noContent: MockResponse = { status: 204 }
const errorBody = (code: string, message: string) => ({ error: { code, message } })

/**
 * The mock backend as a function from request to response, so it can be tested without HTTP.
 * Same paths, bodies, identity and error codes as the Go backend (UD-14).
 */
export function createMockApi(data: StaticData, clock: () => number = Date.now) {
  const lookups = buildLookups(data)
  const places = buildPlaces(lookups)
  let world: World = initialWorld(lookups, 'normal', clock())
  const now = () => clock() + world.clockOffsetMs

  const reset = (scenario: MockScenario) => {
    world = initialWorld(lookups, scenario, clock())
  }

  const status = (): MockStatus => ({ scenario: world.scenario, scenarios: SCENARIOS, clock_offset_s: world.clockOffsetMs / 1000 })

  const endpoints: Endpoint[] = [
    // ---- Existing Go endpoints
    { method: 'GET', pattern: '/api/ping', access: 'public', run: () => ok({ status: 'ok' }) },
    {
      method: 'GET',
      pattern: '/api/me',
      access: 'any',
      run: ({ user, role }): MockResponse => {
        const roles: Role[] = [...(user.is_driver ? (['driver'] as const) : []), ...(user.is_passenger ? (['passenger'] as const) : [])]
        const me: Me = { username: user.username, display_name: user.display_name, role, roles, simulated: user.simulated }
        return ok(me)
      },
    },
    { method: 'GET', pattern: '/api/pickup-points', access: 'any', run: () => ok(data.seed.pickupPoints) },
    { method: 'GET', pattern: '/api/bus-stops', access: 'any', run: () => ok(data.seed.busStops) },
    { method: 'GET', pattern: '/api/tags', access: 'any', run: ({ user }) => ok(tagsView(world, lookups, user.id)) },
    {
      method: 'PUT',
      pattern: '/api/me/tags/:',
      access: 'any',
      run: ({ user, params }) => {
        const tagId = idParam(params[0], '標籤')
        if (!lookups.tagById.has(tagId)) throw new MockError(404, 'not_found', '標籤不在清單中')
        const key = `${user.id}:${tagId}`
        world = world.userTags.includes(key) ? world : { ...world, userTags: [...world.userTags, key] }
        return noContent
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/me/tags/:',
      access: 'any',
      run: ({ user, params }) => {
        const key = `${user.id}:${idParam(params[0], '標籤')}`
        world = { ...world, userTags: world.userTags.filter((k) => k !== key) }
        return noContent
      },
    },
    { method: 'GET', pattern: '/api/driver/profile', access: 'driver', run: ({ user }) => ok(driverProfileView(world, lookups, user.id)) },
    { method: 'GET', pattern: '/api/passenger/profile', access: 'passenger', run: ({ user }) => ok(passengerProfileView(world, lookups, user.id)) },
    {
      method: 'POST',
      pattern: '/api/driver/trips',
      access: 'driver',
      run: ({ user, body }) => {
        world = depart(world, lookups, user.id, departureSettings(body, lookups), now())
        return created(tripView(lookups, activeTripOf(world, user.id)!))
      },
    },
    {
      method: 'GET',
      pattern: '/api/driver/trips/current',
      access: 'driver',
      run: ({ user }) => {
        const trip = activeTripOf(world, user.id)
        if (!trip) throw new MockError(404, 'not_found', '目前沒有進行中的行程')
        return ok({ ...tripView(lookups, trip), passed_pickup: driverTripView(world, lookups, trip, now()).passed_pickup })
      },
    },
    { method: 'GET', pattern: '/api/driver/trips/defaults', access: 'driver', run: ({ user }) => ok(tripDefaultsView(latestTripOf(world, user.id))) },
    {
      method: 'GET',
      pattern: '/api/trips/:',
      access: 'any',
      run: ({ params }) => {
        const trip = findTrip(world, idParam(params[0], '行程'))
        if (!trip) throw new MockError(404, 'not_found', '找不到這個行程')
        return ok(tripView(lookups, trip))
      },
    },
    {
      method: 'POST',
      pattern: '/api/activities',
      access: 'any',
      run: ({ user, role }) => {
        world = declareActivity(world, user.id, role, now())
        const a = latestActivityOf(world, user.id)!
        return created({ id: a.id, role: a.role, trip_id: a.tripId, created_at: new Date(a.createdAtMs).toISOString() })
      },
    },
    {
      method: 'POST',
      pattern: '/api/location',
      access: 'any',
      run: ({ user, body }) => {
        world = reportLocation(world, user.id, locationBody(body), now())
        const a = latestActivityOf(world, user.id)!
        const r = world.lastReports[a.id]
        return created({ id: r.id, activity_id: a.id, trip_id: a.tripId, lat: r.lat, lng: r.lng, reported_at: new Date(r.atMs).toISOString() })
      },
    },

    // ---- Proposed: shared
    { method: 'GET', pattern: '/api/places', access: 'any', run: ({ query }) => ok(searchPlaces(places, query.get('q') ?? '')) },

    // ---- Proposed: driver
    {
      method: 'GET',
      pattern: '/api/driver/trip',
      access: 'driver',
      run: ({ user }) => {
        const trip = latestTripOf(world, user.id)
        return ok({ trip: trip ? driverTripView(world, lookups, trip, now()) : null })
      },
    },
    {
      method: 'POST',
      pattern: '/api/driver/route-preview',
      access: 'driver',
      run: ({ body }) => {
        const req = routePreviewRequest(body, lookups)
        return ok(buildTripPath(lookups, lookups.pickupById.get(req.pickup_point_id)!, req.destination).route)
      },
    },
    ...(['accept', 'decline', 'board', 'complete'] as const).map(
      (action): Endpoint => ({
        method: 'POST',
        pattern: `/api/driver/requests/:/${action}`,
        access: 'driver',
        run: ({ user, params }) => {
          const id = idParam(params[0], '請求')
          if (action === 'accept') world = accept(world, user.id, id)
          if (action === 'decline') world = decline(world, lookups, user.id, id, now())
          if (action === 'board') world = driverBoardRide(world, user.id, id)
          if (action === 'complete') world = driverCompleteRide(world, user.id, id)
          const trip = latestTripOf(world, user.id)
          return ok({ trip: trip ? driverTripView(world, lookups, trip, now()) : null })
        },
      }),
    ),

    // ---- Proposed: passenger
    {
      method: 'GET',
      pattern: '/api/passenger/supply',
      access: 'passenger',
      run: ({ user, query }) => ok(supplyView(world, lookups, user.id, supplyQuery(query, lookups), now())),
    },
    {
      method: 'POST',
      pattern: '/api/passenger/requests',
      access: 'passenger',
      run: ({ user, body }) => {
        world = submitRequest(world, lookups, user.id, requestSubmission(body, lookups), now())
        return created({ request: passengerRequestView(world, lookups, world.requests.at(-1)!, now()) })
      },
    },
    {
      method: 'GET',
      pattern: '/api/passenger/request',
      access: 'passenger',
      run: ({ user }) => {
        const request = world.requests.filter((r) => r.passengerId === user.id).at(-1)
        return ok({ request: request ? passengerRequestView(world, lookups, request, now()) : null })
      },
    },
    ...(['cancel', 'board', 'complete'] as const).map(
      (action): Endpoint => ({
        method: 'POST',
        pattern: `/api/passenger/requests/:/${action}`,
        access: 'passenger',
        run: ({ user, params }) => {
          const request = requireRequest(world, idParam(params[0], '請求'))
          if (request.passengerId !== user.id) throw new MockError(404, 'not_found', '找不到這個請求')
          if (action === 'cancel') world = cancelRequest(world, lookups, request, now())
          if (action === 'board') world = boardRide(world, request)
          if (action === 'complete') world = completeRide(world, request)
          return ok({ request: passengerRequestView(world, lookups, requireRequest(world, request.id), now()) })
        },
      }),
    ),

    // ---- Demo control
    {
      method: 'POST',
      pattern: '/api/demo/reset',
      access: 'public',
      run: () => {
        reset(world.scenario)
        return noContent
      },
    },
    { method: 'GET', pattern: '/api/_mock', access: 'public', run: () => ok(status()) },
    {
      method: 'POST',
      pattern: '/api/_mock/scenario',
      access: 'public',
      run: ({ body }) => {
        const scenario = (body as { scenario?: unknown } | null)?.scenario
        if (!SCENARIOS.includes(scenario as MockScenario)) throw new MockError(400, 'bad_request', `scenario 要是 ${SCENARIOS.join('、')} 之一`)
        reset(scenario as MockScenario)
        return ok(status())
      },
    },
    {
      method: 'POST',
      pattern: '/api/_mock/advance',
      access: 'public',
      run: ({ body }) => {
        const seconds = (body as { seconds?: unknown } | null)?.seconds
        if (typeof seconds !== 'number' || seconds <= 0 || seconds > MAX_ADVANCE_S) {
          throw new MockError(400, 'bad_request', `seconds 要在 1～${MAX_ADVANCE_S} 之間`)
        }
        // One-second steps, so timeouts, pickups and arrivals happen in order.
        for (let s = 0; s < Math.round(seconds); s++) {
          world = { ...world, clockOffsetMs: world.clockOffsetMs + 1000 }
          world = tick(world, lookups, now())
        }
        return ok(status())
      },
    },
  ]

  function match(pattern: string, path: string): string[] | null {
    const want = pattern.split('/')
    const got = path.split('/')
    if (want.length !== got.length) return null
    const params: string[] = []
    for (let i = 0; i < want.length; i++) {
      if (want[i] === ':') params.push(decodeURIComponent(got[i]))
      else if (want[i] !== got[i]) return null
    }
    return params
  }

  /** `Authorization: Bearer <role>:<username>` (DD-18), checked like the Go backend. */
  function authenticate(authorization: string | undefined): { user: SeedUser; role: Role } {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
    const colon = token?.indexOf(':') ?? -1
    const role = token && colon >= 0 ? token.slice(0, colon) : ''
    const username = token && colon >= 0 ? token.slice(colon + 1) : ''
    if (!token || colon < 0 || username === '' || (role !== 'driver' && role !== 'passenger')) {
      throw new MockError(401, 'unauthorized', '需要 Authorization: Bearer <角色>:<帳號>')
    }
    const user = lookups.userByName.get(username)
    if (!user) throw new MockError(401, 'unauthorized', '帳號不存在')
    if ((role === 'driver' && !user.is_driver) || (role === 'passenger' && !user.is_passenger)) {
      throw new MockError(403, 'forbidden', '此帳號沒有該角色')
    }
    return { user, role }
  }

  function handle(req: MockRequest): MockResponse {
    const candidates = endpoints.flatMap((e) => {
      const params = match(e.pattern, req.path)
      return params ? [{ endpoint: e, params }] : []
    })
    if (candidates.length === 0) return { status: 404, body: errorBody('not_found', '找不到這個 API') }
    const found = candidates.find((c) => c.endpoint.method === req.method)
    if (!found) return { status: 405, body: errorBody('method_not_allowed', '不支援這個方法') }

    try {
      const { endpoint, params } = found
      // Public endpoints never read the identity; any user fills the slot.
      const identity =
        endpoint.access === 'public' ? { user: lookups.users[0], role: 'passenger' as const } : authenticate(req.authorization)
      if (endpoint.access !== 'public' && endpoint.access !== 'any' && endpoint.access !== identity.role) {
        throw new MockError(403, 'forbidden', '此角色不能使用這個 API')
      }
      if (endpoint.access !== 'public') world = tick(world, lookups, now())
      return endpoint.run({ ...identity, params, body: req.body, query: req.query })
    } catch (err) {
      if (err instanceof MockError) return { status: err.status, body: errorBody(err.code, err.message) }
      console.error('mock backend error:', err)
      return { status: 500, body: errorBody('internal', '伺服器發生錯誤') }
    }
  }

  return { handle }
}
