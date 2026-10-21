// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { selectStageTag, STAGE_ACCOUNTS, STAGE_TAG, type Call } from './stageTag.ts'

/** A fake API that records every call and serves one tag list. */
function fakeApi(tags: { id: number; name: string }[]) {
  const calls: { account: string; method: string; path: string }[] = []
  const call: Call = async (account, method, path) => {
    calls.push({ account, method, path })
    return { status: 200, body: path === '/tags' ? tags : null } as never
  }
  return { call, calls }
}

describe('selectStageTag (T34, REQ-040: both stage drivers must carry the required tag)', () => {
  const tags = [
    { id: 1, name: '不抽菸' },
    { id: 6, name: STAGE_TAG },
  ]

  it('names driver4 and driver5 as the stage accounts', () => {
    expect(STAGE_ACCOUNTS).toEqual(['driver4', 'driver5'])
  })

  it('selects the stage tag for the given account', async () => {
    const { call, calls } = fakeApi(tags)
    await selectStageTag(call, 'driver4')
    expect(calls).toContainEqual({ account: 'driver4', method: 'PUT', path: '/me/tags/6' })
  })

  it('selects it only for that account', async () => {
    const { call, calls } = fakeApi(tags)
    await selectStageTag(call, 'driver5')
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.account)).toEqual(['driver5'])
  })

  it('fails loudly when the tag does not exist', async () => {
    const { call } = fakeApi([{ id: 1, name: '不抽菸' }])
    await expect(selectStageTag(call, 'driver4')).rejects.toThrow(STAGE_TAG)
  })

  it('fails loudly when selecting the tag is refused', async () => {
    const call: Call = async (_a, method) => ({ status: method === 'PUT' ? 500 : 200, body: [{ id: 6, name: STAGE_TAG }] }) as never
    await expect(selectStageTag(call, 'driver4')).rejects.toThrow('driver4')
  })
})
