// The required tags of the Demo (T34, T43, T65, docs/demo-script.md). Requests are matched on them
// (REQ-040), so both stage drivers must carry both before the passenger submits: driver5 is asked
// first and declines, then the request goes on to driver4. Of the simulated drivers, driver3 is
// seeded with both 不抽菸 and 安靜通勤; it loses 安靜通勤 so it never gets the request. Its 不抽菸
// stays: the seed ranking test reads it from the shared database.
import type { ApiClient, Tag } from '@carpool/shared'

/** The required tags of the Demo, by name: only driver4 and driver5 carry both. */
export const STAGE_TAGS = ['不抽菸', '安靜通勤']
export const STAGE_ACCOUNTS = ['driver4', 'driver5']
/** Earlier stage tags (T43) the stage drivers may still carry; dropped so they show only the stage tags. */
export const OFF_STAGE_TAGS = ['可載行李']
/** The seeded driver that carries both stage tags, and the stage tag it drops (T65). */
export const SEEDED_WITH_STAGE_TAGS = { account: 'driver3', drop: '安靜通勤' }

async function tagIds(api: ApiClient, names: string[]): Promise<{ id: number; name: string }[]> {
  const tags = await api.get<Tag[]>('/tags')
  return names.map((name) => {
    const tag = tags.find((t) => t.name === name)
    if (!tag) throw new Error(`找不到標籤「${name}」`)
    return { id: tag.id, name }
  })
}

const failed = (account: string, verb: string, name: string) => (err: unknown) => {
  throw new Error(`${account} ${verb}標籤「${name}」失敗：${err instanceof Error ? err.message : String(err)}`)
}

/** Selects the stage tags for a driver and drops the earlier ones; idempotent, so it is safe to run on every start (DD-45 step 1). */
export async function selectStageTags(api: ApiClient, account: string) {
  for (const tag of await tagIds(api, STAGE_TAGS)) await api.put(`/me/tags/${tag.id}`).catch(failed(account, '選擇', tag.name))
  for (const tag of await tagIds(api, OFF_STAGE_TAGS)) await api.delete(`/me/tags/${tag.id}`).catch(failed(account, '取消', tag.name))
}

/** Drops the stage tag a seeded driver would otherwise share with the stage drivers; idempotent (T65). */
export async function clearStageTagsFromSeeded(api: ApiClient, account: string) {
  for (const tag of await tagIds(api, [SEEDED_WITH_STAGE_TAGS.drop])) await api.delete(`/me/tags/${tag.id}`).catch(failed(account, '取消', tag.name))
}
