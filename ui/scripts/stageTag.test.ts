// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { selectStageTags, STAGE_ACCOUNTS, STAGE_TAGS, type Call } from './stageTag.ts'

/** A fake API that records every call and serves one tag list. */
function fakeApi(tags: { id: number; name: string }[]) {
  const calls: { account: string; method: string; path: string }[] = []
  const call: Call = async (account, method, path) => {
    calls.push({ account, method, path })
    return { status: 200, body: path === '/tags' ? tags : null } as never
  }
  return { call, calls }
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

  it('selects both stage tags, and only them, for the given account', async () => {
    const { call, calls } = fakeApi(tags)
    await selectStageTags(call, 'driver4')
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([
      { account: 'driver4', method: 'PUT', path: '/me/tags/1' },
      { account: 'driver4', method: 'PUT', path: '/me/tags/2' },
    ])
  })

  it('selects them only for that account', async () => {
    const { call, calls } = fakeApi(tags)
    await selectStageTags(call, 'driver5')
    expect(new Set(calls.filter((c) => c.method === 'PUT').map((c) => c.account))).toEqual(new Set(['driver5']))
  })

  it('fails loudly when a stage tag does not exist', async () => {
    const { call } = fakeApi([{ id: 1, name: '不抽菸' }])
    await expect(selectStageTags(call, 'driver4')).rejects.toThrow('可載行李')
  })

  it('fails loudly when selecting a tag is refused', async () => {
    const call: Call = async (_a, method) => ({ status: method === 'PUT' ? 400 : 200, body: tags }) as never
    await expect(selectStageTags(call, 'driver4')).rejects.toThrow('driver4')
  })
})
