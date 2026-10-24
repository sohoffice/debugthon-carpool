import { ApiError, type ApiClient } from '@carpool/shared'
import { describe, expect, it } from 'vitest'
import { clearStageTagsFromSeeded, OFF_STAGE_TAGS, selectStageTags, STAGE_ACCOUNTS, STAGE_TAGS } from './stageTag'

/** A fake API client that records every call and serves one tag list; `refuse` fails every PUT and DELETE. */
function fakeApi(tags: { id: number; name: string }[], refuse = false) {
  const calls: { method: string; path: string }[] = []
  const record = (method: string) => async (path: string) => {
    calls.push({ method, path })
    if (refuse && (method === 'PUT' || method === 'DELETE')) throw new ApiError(400, '這個標籤不適用於你的角色')
    return (path === '/tags' ? tags : undefined) as never
  }
  const api: ApiClient = { get: record('GET'), post: record('POST'), put: record('PUT'), delete: record('DELETE') }
  return { api, calls }
}

describe('selectStageTags (T34, T43, T65, REQ-040: both stage drivers must carry the required tags)', () => {
  const tags = [
    { id: 1, name: '不抽菸' },
    { id: 2, name: '可載行李' },
    { id: 3, name: '安靜通勤' },
  ]

  it('names 不抽菸 and 安靜通勤 as the stage tags, and driver4 and driver5 as the stage accounts', () => {
    expect(STAGE_TAGS).toEqual(['不抽菸', '安靜通勤'])
    expect(OFF_STAGE_TAGS).toEqual(['可載行李'])
    expect(STAGE_ACCOUNTS).toEqual(['driver4', 'driver5'])
  })

  it('selects both stage tags and drops 可載行李, the earlier stage tag', async () => {
    const { api, calls } = fakeApi(tags)
    await selectStageTags(api, 'driver4')
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([
      { method: 'PUT', path: '/me/tags/1' },
      { method: 'PUT', path: '/me/tags/3' },
      { method: 'DELETE', path: '/me/tags/2' },
    ])
  })

  it('fails loudly when a stage tag does not exist', async () => {
    const { api } = fakeApi([{ id: 1, name: '不抽菸' }])
    await expect(selectStageTags(api, 'driver4')).rejects.toThrow('安靜通勤')
  })

  it('fails loudly, naming the account, when selecting a tag is refused', async () => {
    const { api } = fakeApi(tags, true)
    await expect(selectStageTags(api, 'driver5')).rejects.toThrow('driver5 選擇標籤「不抽菸」失敗')
  })
})

describe('clearStageTagsFromSeeded (T65): no simulated car may carry both stage tags', () => {
  const tags = [
    { id: 1, name: '不抽菸' },
    { id: 2, name: '可載行李' },
    { id: 3, name: '安靜通勤' },
  ]

  it("drops only driver3's 安靜通勤; its 不抽菸 stays for the seed ranking test", async () => {
    const { api, calls } = fakeApi(tags)
    await clearStageTagsFromSeeded(api, 'driver3')
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([{ method: 'DELETE', path: '/me/tags/3' }])
  })

  it('fails loudly, naming the account, when the backend refuses', async () => {
    const { api } = fakeApi(tags, true)
    await expect(clearStageTagsFromSeeded(api, 'driver3')).rejects.toThrow('driver3 取消標籤「安靜通勤」失敗')
  })
})
