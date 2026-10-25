import { ApiError, type ApiClient } from '@carpool/shared'
import { describe, expect, it } from 'vitest'
import { createOffstage } from './offstage'
import { SIMULATOR_ROUTES } from './simulatorRoutes'

const PICKUP = { id: 1, name: '松山車站', lat: 25.049806, lng: 121.578206, radius_m: 80 }
const DESTINATION = { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }

interface World {
  down: boolean
  d4Trip: number | null
  d5Trip: number | null
  d5Passed: boolean
  pending: { id: number; passenger_name: string }[]
  /** Status the backend refuses driver5's departure with, if any. */
  refuseDepart: number | null
  /** Status the backend refuses driver5's decline with, if any. */
  refuseDecline: number | null
  /** Status the backend refuses a location report with, if any. */
  refuseReport: number | null
}

/** A fake backend behind both stage drivers' API clients, recording what driver5 did. */
function fakeStage(init: Partial<World> = {}) {
  const world: World = { down: false, d4Trip: null, d5Trip: null, d5Passed: false, pending: [], refuseDepart: null, refuseDecline: null, refuseReport: null, ...init }
  const departs: unknown[] = []
  const declines: number[] = []
  /** Location reports and log lines in the order they happened. */
  const events: string[] = []
  const client = (account: 'driver4' | 'driver5'): ApiClient => {
    const call = async (method: string, path: string, body?: unknown) => {
      if (world.down) throw new TypeError('Failed to fetch')
      const tripId = account === 'driver4' ? world.d4Trip : world.d5Trip
      if (method === 'GET' && path === '/driver/requests') return { trip_id: tripId, pending: account === 'driver5' ? world.pending : [], passengers: [] }
      if (method === 'GET' && path === '/driver/trips/current') {
        if (tripId === null) throw new ApiError(404, '目前沒有進行中的行程', 'not_found')
        return { id: tripId, pickup_point: PICKUP, destination: DESTINATION }
      }
      if (method === 'GET' && path === `/trips/${world.d5Trip}`) return { id: world.d5Trip, passed_pickup: world.d5Passed }
      if (account === 'driver5' && method === 'POST' && path === '/driver/trips') {
        if (world.refuseDepart) throw new ApiError(world.refuseDepart, '駕駛已有進行中的行程', 'already_active')
        departs.push(body)
        world.d5Trip = 50
        return { id: 50 }
      }
      if (method === 'POST' && path === '/location') {
        if (world.refuseReport) throw new ApiError(world.refuseReport, '請先表示今天要參與，再回報位置', 'no_activity')
        const { lat, lng } = body as { lat: number; lng: number }
        events.push(`${account} @ ${lat},${lng}`)
        return {}
      }
      const decline = path.match(/^\/driver\/requests\/(\d+)\/decline$/)
      if (account === 'driver5' && method === 'POST' && decline) {
        if (world.refuseDecline) throw new ApiError(world.refuseDecline, world.refuseDecline === 409 ? '請求已不在等待駕駛回應' : '伺服器錯誤')
        declines.push(Number(decline[1]))
        world.pending = world.pending.filter((r) => r.id !== Number(decline[1]))
        return {}
      }
      throw new ApiError(404, `沒有 ${method} ${path}`)
    }
    return {
      get: (path) => call('GET', path) as never,
      post: (path, body) => call('POST', path, body) as never,
      put: (path, body) => call('PUT', path, body) as never,
      delete: (path) => call('DELETE', path) as never,
    }
  }
  const logs: { text: string; error: boolean }[] = []
  const requests: [string, number][] = []
  const tick = createOffstage(
    { driver4: client('driver4'), driver5: client('driver5') },
    (text, error = false) => {
      logs.push({ text, error })
      events.push(text)
    },
    (account, tripId) => requests.push([account, tripId]),
  )
  return { world, departs, declines, events, logs, requests, tick, texts: () => logs.map((l) => l.text) }
}

describe('off-stage part of the Demo (DD-45)', () => {
  it('driver5 follows driver4 out to the same pickup and destination, no auto-accept, no tag filters', async () => {
    const stage = fakeStage()
    await stage.tick()
    expect(stage.departs).toEqual([])
    expect(stage.logs).toEqual([])

    stage.world.d4Trip = 40
    await stage.tick()
    expect(stage.departs).toEqual([{ pickup_point_id: 1, destination: DESTINATION, capacity: 3, auto_accept: false, tag_filters: [] }])
    expect(stage.texts()).toEqual(['driver4 出發了', 'driver5 跟著出發了'])

    // Once per driver4 trip.
    await stage.tick()
    expect(stage.departs).toHaveLength(1)
  })

  it('reuses a trip driver5 is already on', async () => {
    const stage = fakeStage({ d4Trip: 40, d5Trip: 7 })
    await stage.tick()
    expect(stage.departs).toEqual([])
    expect(stage.texts()).toEqual(['driver4 出發了', 'driver5 已經在行程中，沿用這趟'])
  })

  it("reports both stage cars' path starts, each with its own token, before saying driver5 followed (DD-45 step 2, T75)", async () => {
    const stage = fakeStage({ d4Trip: 40 })
    await stage.tick()
    expect(stage.events).toEqual([
      'driver4 出發了',
      `driver4 @ ${SIMULATOR_ROUTES.driver4.path[0].join(',')}`,
      `driver5 @ ${SIMULATOR_ROUTES.driver5.path[0].join(',')}`,
      'driver5 跟著出發了',
    ])
    // Once per departure: the simulator reports from then on (DD-14).
    await stage.tick()
    expect(stage.events).toHaveLength(4)
  })

  it("reusing driver5's trip still reports driver4's start before the log, so driver4 is matchable when driver5 declines", async () => {
    const stage = fakeStage({ d4Trip: 40, d5Trip: 7 })
    await stage.tick()
    expect(stage.events).toEqual(['driver4 出發了', `driver4 @ ${SIMULATOR_ROUTES.driver4.path[0].join(',')}`, 'driver5 已經在行程中，沿用這趟'])
  })

  it('a refused start report is logged once and retried next round, the log line waiting for it', async () => {
    const stage = fakeStage({ d4Trip: 40, refuseReport: 409 })
    await stage.tick()
    await stage.tick()
    expect(stage.logs).toEqual([
      { text: 'driver4 出發了', error: false },
      { text: 'driver4 回報起點失敗：請先表示今天要參與，再回報位置', error: true },
    ])
    expect(stage.departs).toHaveLength(1)

    stage.world.refuseReport = null
    await stage.tick()
    expect(stage.events.slice(-3)).toEqual([
      `driver4 @ ${SIMULATOR_ROUTES.driver4.path[0].join(',')}`,
      `driver5 @ ${SIMULATOR_ROUTES.driver5.path[0].join(',')}`,
      'driver5 跟著出發了',
    ])
    await stage.tick()
    expect(stage.texts().filter((t) => t === 'driver5 跟著出發了')).toHaveLength(1)
  })

  it('the backend dropping during the start reports is retried like any round, without departing twice', async () => {
    const stage = fakeStage({ d4Trip: 40, refuseReport: 502 })
    await stage.tick()
    expect(stage.texts()).toEqual(['driver4 出發了', '連不到後端，每秒重試'])

    stage.world.refuseReport = null
    await stage.tick()
    expect(stage.departs).toHaveLength(1)
    expect(stage.texts().slice(2)).toEqual(['driver5 跟著出發了', '後端恢復了'])
  })

  it('logs a refused departure as an error', async () => {
    const stage = fakeStage({ d4Trip: 40, refuseDepart: 409 })
    await stage.tick()
    expect(stage.logs).toContainEqual({ text: 'driver5 出發失敗：駕駛已有進行中的行程', error: true })
  })

  it('driver5 declines every request it gets, once each (REQ-049)', async () => {
    const stage = fakeStage({ d4Trip: 40, d5Trip: 7, pending: [{ id: 9, passenger_name: '乘客 小美' }] })
    await stage.tick()
    expect(stage.declines).toEqual([9])
    expect(stage.texts()).toContain('driver5 婉拒了乘客 小美的請求')
    await stage.tick()
    expect(stage.declines).toEqual([9])
  })

  it("tells the simulator about driver5's request before declining it, so the car is released (T63)", async () => {
    const stage = fakeStage({ d4Trip: 40, d5Trip: 7 })
    await stage.tick()
    expect(stage.requests).toEqual([])

    stage.world.pending = [{ id: 9, passenger_name: '乘客 小美' }]
    await stage.tick()
    expect(stage.requests).toEqual([['driver5', 7]])
    expect(stage.declines).toEqual([9])
  })

  it('a request answered meanwhile (409) is not an error; another refusal is', async () => {
    const answered = fakeStage({ d5Trip: 7, pending: [{ id: 9, passenger_name: '乘客 小美' }], refuseDecline: 409 })
    await answered.tick()
    expect(answered.logs.filter((l) => l.error)).toEqual([])

    const refused = fakeStage({ d5Trip: 7, pending: [{ id: 9, passenger_name: '乘客 小美' }], refuseDecline: 400 })
    await refused.tick()
    expect(refused.logs).toContainEqual({ text: 'driver5 婉拒失敗：伺服器錯誤', error: true })
  })

  it('says once when driver5 has passed the pickup, and when its trip is gone', async () => {
    const stage = fakeStage({ d5Trip: 7 })
    await stage.tick()
    expect(stage.texts()).toEqual([])
    stage.world.d5Passed = true
    await stage.tick()
    await stage.tick()
    expect(stage.texts()).toEqual(['注意：driver5 已經過上車點，之後的請求會直接配給 driver4'])

    stage.world.d5Trip = null
    await stage.tick()
    await stage.tick()
    expect(stage.texts().at(-1)).toBe('driver5 沒有進行中的行程了')
    expect(stage.texts().filter((t) => t === 'driver5 沒有進行中的行程了')).toHaveLength(1)
  })

  it('retries every round while the backend is down and carries on when it is back', async () => {
    const stage = fakeStage({ down: true })
    await stage.tick()
    await stage.tick()
    expect(stage.logs).toEqual([{ text: '連不到後端，每秒重試', error: true }])

    // driver4 departed while the backend was coming back: driver5 still follows.
    stage.world.down = false
    stage.world.d4Trip = 40
    await stage.tick()
    expect(stage.texts()).toEqual(['連不到後端，每秒重試', 'driver4 出發了', 'driver5 跟著出發了', '後端恢復了'])
  })

  it('retries the follow when the backend drops just as driver5 departs', async () => {
    const stage = fakeStage({ d4Trip: 40, refuseDepart: 502 })
    await stage.tick()
    expect(stage.texts()).toEqual(['driver4 出發了', '連不到後端，每秒重試'])
    expect(stage.departs).toEqual([])

    stage.world.refuseDepart = null
    await stage.tick()
    expect(stage.departs).toHaveLength(1)
    expect(stage.texts().slice(2)).toEqual(['driver5 跟著出發了', '後端恢復了'])
  })
})
