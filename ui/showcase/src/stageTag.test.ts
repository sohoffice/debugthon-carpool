import { ApiError, type ApiClient } from '@carpool/shared'
import { describe, expect, it } from 'vitest'
import { selectStageTags, STAGE_ACCOUNTS, STAGE_TAGS } from './stageTag'

/** A fake API client that records every call and serves one tag list; `refuse` fails every PUT. */
function fakeApi(tags: { id: number; name: string }[], refuse = false) {
  const calls: { method: string; path: string }[] = []
  const record = (method: string) => async (path: string) => {
    calls.push({ method, path })
    if (refuse && method === 'PUT') throw new ApiError(400, '這個標籤不適用於你的角色')
    return (path === '/tags' ? tags : undefined) as never
  }
  const api: ApiClient = { get: record('GET'), post: record('POST'), put: record('PUT'), delete: record('DELETE') }
  return { api, calls }
}

describe('selectStageTags (T34, T43, REQ-040: both stage drivers must carry the required tags)', () => {
  const tags = [
    { id: 1, name: '不抽菸' },
    { id: 2, name: '可載行李' },
    { id: 3, name: '安靜通勤' },
  ]

  it('names 不抽菸 and 可載行李 as the stage tags, and driver4 and driver5 as the stage accounts', () => {
    expect(STAGE_TAGS).toEqual(['不抽菸', '可載行李'])
    expect(STAGE_ACCOUNTS).toEqual(['driver4', 'driver5'])
  })

  it('selects both stage tags, and only them', async () => {
    const { api, calls } = fakeApi(tags)
    await selectStageTags(api, 'driver4')
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([
      { method: 'PUT', path: '/me/tags/1' },
      { method: 'PUT', path: '/me/tags/2' },
    ])
  })

  it('fails loudly when a stage tag does not exist', async () => {
    const { api } = fakeApi([{ id: 1, name: '不抽菸' }])
    await expect(selectStageTags(api, 'driver4')).rejects.toThrow('可載行李')
  })

  it('fails loudly, naming the account, when selecting a tag is refused', async () => {
    const { api } = fakeApi(tags, true)
    await expect(selectStageTags(api, 'driver5')).rejects.toThrow('driver5 選擇標籤「不抽菸」失敗')
  })
})
