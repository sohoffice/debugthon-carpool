// @vitest-environment node
import { ApiError, type ApiClient, type DriverRequests, type RequestView, type Tag } from '@carpool/shared'
import { describe, expect, it } from 'vitest'
import { createMockApi } from '../../mock-server/src/api.ts'
import { loadStaticData } from '../../mock-server/src/data/load.ts'
import { createOffstage } from './offstage'
import { selectStageTags, STAGE_ACCOUNTS, STAGE_TAGS } from './stageTag'

const DESTINATION = { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }
const DEPARTURE = { pickup_point_id: 1, destination: DESTINATION, capacity: 3, auto_accept: false, tag_filters: [] }
/** 25 m north of 松山車站, as the passenger debug mode's preset (DD-26). */
const AT_PICKUP = { lat: 25.049806 + 25 / 111195, lng: 121.578206 }
/** Off-stage rounds before giving up on the log line; one second apart, as useOffstage. */
const MAX_ROUNDS = 5

/** The static site's backend (followReports, as installMock.ts) behind API clients, on a clock the test moves. */
function staticSite() {
  let clock = Date.parse('2026-10-24T08:12:00+08:00')
  const api = createMockApi(loadStaticData(), () => clock, { followReports: true })
  const client = (role: string, account: string): ApiClient => {
    const call = async (method: string, path: string, body?: unknown) => {
      const [pathname, qs] = `/api${path}`.split('?')
      const res = api.handle({ method, path: pathname, query: new URLSearchParams(qs), authorization: `Bearer ${role}:${account}`, body })
      if (res.status >= 400) {
        const error = (res.body as { error: { code: string; message: string } }).error
        throw new ApiError(res.status, error.message, error.code)
      }
      return res.body
    }
    return {
      get: (path) => call('GET', path) as never,
      post: (path, body) => call('POST', path, body) as never,
      put: (path, body) => call('PUT', path, body) as never,
      delete: (path) => call('DELETE', path) as never,
    }
  }
  return { client, advance: (ms: number) => (clock += ms) }
}

describe('開始 Demo on the static site, before the simulator reports (DD-45, T75)', () => {
  it('a request sent right after 「driver5 跟著出發了」 goes to driver5 first, not straight to driver4', async () => {
    const site = staticSite()
    const drivers = { driver4: site.client('driver', 'driver4'), driver5: site.client('driver', 'driver5') }
    for (const account of STAGE_ACCOUNTS) await selectStageTags(site.client('driver', account), account)
    const logs: string[] = []
    // Only the off-stage part runs: the simulator, polling trips once a second, has not reported yet.
    const tick = createOffstage(drivers, (text) => logs.push(text))

    await drivers.driver4.post('/driver/trips', DEPARTURE)
    for (let i = 0; i < MAX_ROUNDS && !logs.includes('driver5 跟著出發了'); i++) {
      site.advance(1000)
      await tick()
    }
    expect(logs).toContain('driver5 跟著出發了')

    // No settle pause: the passenger sends at once, with the Demo's stage tags 一定要.
    const passenger = site.client('passenger', 'passenger1')
    const tags = await passenger.get<Tag[]>('/tags')
    const required = STAGE_TAGS.map((name) => ({ tag_id: tags.find((t) => t.name === name)!.id, intent: 'required' }))
    const request = await passenger.post<RequestView>('/passenger/requests', {
      pickup_point_id: 1,
      destination: DESTINATION,
      stop_ids: [9, 23],
      tag_filters: required,
      location: AT_PICKUP,
    })
    const pendingFor = async (driver: ApiClient) => (await driver.get<DriverRequests>('/driver/requests')).pending.map((r) => r.id)
    expect(await pendingFor(drivers.driver5)).toEqual([request.id])
    expect(await pendingFor(drivers.driver4)).toEqual([])

    // driver5 declines on the next round, and it goes on to driver4 (DD-45 step 3, REQ-050).
    site.advance(1000)
    await tick()
    expect(logs.at(-1)).toMatch(/^driver5 婉拒了/)
    expect(await pendingFor(drivers.driver4)).toEqual([request.id])
  })
})
