import { createApiClient } from '@carpool/shared'
import type { AddLog } from './log'
import { clearStageTagsFromSeeded, SEEDED_WITH_STAGE_TAGS, selectStageTags, STAGE_ACCOUNTS, STAGE_TAGS } from './stageTag'

/** Demo reset (DD-29): the backend's demo environment only. */
export async function resetDemo() {
  const res = await fetch('/api/demo/reset', { method: 'POST' })
  if (!res.ok) throw new Error(`重設失敗（${res.status}）`)
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * 開始 Demo up to the simulator (DD-45 step 1): reset, then driver4 and driver5 take the Demo's
 * required tags and driver3 drops the one it shares with them (T65). The caller starts the simulator and reloads the phones. Throws a short message
 * after logging the detail, so the button shows only 開始失敗 (UD-30 part 1).
 */
export async function prepareStart(log: AddLog) {
  try {
    await resetDemo()
    log('開始 Demo：資料已重設')
    for (const account of STAGE_ACCOUNTS) await selectStageTags(createApiClient('driver', account), account)
    const { account: seeded } = SEEDED_WITH_STAGE_TAGS
    await clearStageTagsFromSeeded(createApiClient('driver', seeded), seeded)
    log(`標籤已選好：${STAGE_ACCOUNTS.join('、')} 都帶「${STAGE_TAGS.join('」「')}」`)
  } catch (err) {
    log(`開始失敗：${reason(err)}`, true)
    throw err
  }
}

/** 重新開始: reset only; the simulator keeps running and the tags stay (DD-29, DD-45 step 1). */
export async function restart(log: AddLog) {
  try {
    await resetDemo()
    log('重新開始：資料已重設，兩支手機重新載入')
  } catch (err) {
    log(`重新開始失敗：${reason(err)}`, true)
    throw err
  }
}
