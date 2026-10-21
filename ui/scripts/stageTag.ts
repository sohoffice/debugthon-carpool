// The required tag of the Demo (T34, docs/demo-script.md). Requests are matched on it (REQ-040),
// so both stage drivers must carry it before the passenger submits: driver5 is asked first and
// declines, then the request goes on to driver4.
/** The required tag of the Demo: only driver4 and driver5 carry it. */
export const STAGE_TAG = '女性友善'
export const STAGE_ACCOUNTS = ['driver4', 'driver5']

export type Call = <T>(account: string, method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>

/** Selects the stage tag for a driver; idempotent, so it is safe to run on every start. */
export async function selectStageTag(call: Call, account: string) {
  const tags = await call<{ id: number; name: string }[]>(account, 'GET', '/tags')
  const tag = tags.body.find((t) => t.name === STAGE_TAG)
  if (!tag) throw new Error(`找不到標籤「${STAGE_TAG}」`)
  const res = await call(account, 'PUT', `/me/tags/${tag.id}`)
  if (res.status >= 300) throw new Error(`${account} 選擇標籤「${STAGE_TAG}」失敗：${res.status}`)
}
