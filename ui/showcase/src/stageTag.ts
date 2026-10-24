// The required tags of the Demo (T34, T43, docs/demo-script.md). Requests are matched on them
// (REQ-040), so both stage drivers must carry both before the passenger submits: driver5 is asked
// first and declines, then the request goes on to driver4. Of the simulated drivers, driver2 has
// only 可載行李 and driver3 only 不抽菸, so neither gets the request.
import type { ApiClient, Tag } from '@carpool/shared'

/** The required tags of the Demo, by name: only driver4 and driver5 carry both. */
export const STAGE_TAGS = ['不抽菸', '可載行李']
export const STAGE_ACCOUNTS = ['driver4', 'driver5']

/** Selects the stage tags for a driver; idempotent, so it is safe to run on every start (DD-45 step 1). */
export async function selectStageTags(api: ApiClient, account: string) {
  const tags = await api.get<Tag[]>('/tags')
  for (const name of STAGE_TAGS) {
    const tag = tags.find((t) => t.name === name)
    if (!tag) throw new Error(`找不到標籤「${name}」`)
    await api.put(`/me/tags/${tag.id}`).catch((err: unknown) => {
      throw new Error(`${account} 選擇標籤「${name}」失敗：${err instanceof Error ? err.message : String(err)}`)
    })
  }
}
