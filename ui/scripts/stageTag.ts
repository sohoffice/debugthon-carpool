// The required tags of the Demo (T34, T43, docs/demo-script.md). Requests are matched on them
// (REQ-040), so both stage drivers must carry both before the passenger submits: driver5 is asked
// first and declines, then the request goes on to driver4. Of the simulated drivers, driver2 has
// only 可載行李 and driver3 only 不抽菸, so neither gets the request.
/** The required tags of the Demo, by name: only driver4 and driver5 carry both. */
export const STAGE_TAGS = ['不抽菸', '可載行李']
export const STAGE_ACCOUNTS = ['driver4', 'driver5']

export type Call = <T>(account: string, method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>

/** Selects the stage tags for a driver; idempotent, so it is safe to run on every start. */
export async function selectStageTags(call: Call, account: string) {
  const tags = await call<{ id: number; name: string }[]>(account, 'GET', '/tags')
  for (const name of STAGE_TAGS) {
    const tag = tags.body.find((t) => t.name === name)
    if (!tag) throw new Error(`找不到標籤「${name}」`)
    const res = await call(account, 'PUT', `/me/tags/${tag.id}`)
    if (res.status >= 300) throw new Error(`${account} 選擇標籤「${name}」失敗：${res.status}`)
  }
}
