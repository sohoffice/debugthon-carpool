// The whole Demo, hands-off (docs/demo-script.md): presses 開始 Demo on the showcase, which runs the
// simulator and the off-stage part itself (DD-14, DD-45), then works the two phones the way the
// speaker would, with a pause between steps so people can follow on screen. It waits on the
// showcase's own log (UD-30) instead of terminal cues. A screenshot of each step goes to
// test-results/demo-auto/. Runs against `just demo` (backend :8080, showcase :5170). Not a test.
import { chromium, type FrameLocator, type Page } from '@playwright/test'

const SHOWCASE = process.env.DEMO_SHOWCASE ?? 'http://localhost:5170'
const HEADLESS = process.env.DEMO_HEADLESS === '1'
/** Seconds between steps in a visible window; none when headless. */
const PAUSE_MS = HEADLESS ? 0 : 3000
/** The last screen stays up this long before the window closes. */
const LINGER_MS = HEADLESS ? 0 : 15000
const SETTLE_MS = 1000
/** A file path next to this script (`pathname` is URL-encoded). */
const here = (relative: string) => decodeURIComponent(new URL(relative, import.meta.url).pathname)
const SHOTS = here('../test-results/demo-auto/')
/** driver4 fast-forwards past the pickup about 4 s after it is confirmed (T64); leave room. */
const CAR_ARRIVES_MS = 30_000
/** After 我已上車 driver4 fast-forwards to the destination and the trip ends by itself, about 6 s (T64); leave room. */
const TRIP_ENDS_MS = 30_000

const t0 = Date.now()
const say = (text: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} 秒] ${text}`)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits until the showcase log (UD-30 part 2) has a line matching `pattern`; fails on a logged error. */
async function logged(page: Page, pattern: RegExp, timeoutMs: number) {
  await page.getByRole('button', { name: /^紀錄/ }).click()
  const list = page.getByRole('list', { name: '紀錄' })
  try {
    const until = Date.now() + timeoutMs
    for (;;) {
      if ((await list.getByRole('listitem').filter({ hasText: pattern }).count()) > 0) return
      const errors = await list.locator('li[data-error]').allTextContents()
      if (errors.length > 0) throw new Error(`展示頁的紀錄有錯誤：${errors.join('；')}`)
      if (Date.now() > until) throw new Error(`等不到紀錄 ${pattern}`)
      await sleep(250)
    }
  } finally {
    // Closed again, so the screenshots show the stage as the audience sees it.
    await page.getByRole('button', { name: '收起紀錄' }).click()
  }
}

/** Both stage tags 一定要, then send (T65: no 最好, so nothing is relaxed). */
async function sendRequest(passenger: FrameLocator) {
  await passenger.getByRole('button', { name: '今天我要搭' }).click()
  const sheet = passenger.getByRole('dialog', { name: '送出搭車請求' })
  for (const name of ['不抽菸', '安靜坐車']) {
    await sleep(PAUSE_MS / 3)
    await sheet.getByRole('radiogroup', { name: `${name}的篩選` }).getByRole('radio', { name: '一定要' }).click()
  }
  // The browser remembers filters (7.1): an earlier Demo's 能放大件行李 一定要 would match no car.
  for (const name of ['能放大件行李', '可以聊天']) {
    await sheet.getByRole('radiogroup', { name: `${name}的篩選` }).getByRole('radio', { name: '不在意' }).click()
  }
  await sleep(PAUSE_MS)
  await passenger.getByRole('button', { name: '送出請求' }).click()
  await passenger.getByRole('heading', { name: '正在等駕駛確認' }).waitFor({ timeout: 15_000 })
}

async function main() {
  const ping = await fetch(`${SHOWCASE}/api/ping`).catch(() => null)
  if (!ping?.ok) throw new Error(`連不到展示頁或後端 ${SHOWCASE}，請先執行 just demo`)

  const browser = await chromium.launch({ headless: HEADLESS, args: ['--window-size=1600,1000'] })
  try {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage()
    const driver = page.frameLocator('iframe[title="駕駛 App"]')
    const passenger = page.frameLocator('iframe[title="乘客 App"]')
    let shots = 0
    const step = async (name: string, text: string) => {
      shots += 1
      // Screens slide in; let the transition finish so the shot shows the whole screen
      await sleep(SETTLE_MS)
      await page.screenshot({ path: `${SHOTS}${String(shots).padStart(2, '0')}-${name}.png` })
      say(text)
      await sleep(PAUSE_MS)
    }

    await page.goto(SHOWCASE)
    await page.getByRole('button', { name: '開始 Demo' }).click()
    await page.getByRole('button', { name: '重新開始' }).waitFor({ timeout: 20_000 })
    await logged(page, /模擬器開始了/, 5_000)
    await driver.getByRole('heading', { name: '今天載人嗎？' }).waitFor({ timeout: 20_000 })
    await step('start', '按「開始 Demo」：重設、選好標籤、模擬器開始，兩支手機重新載入。')

    await driver.getByRole('button', { name: '我出發了' }).click()
    await driver.getByRole('heading', { name: /目前沒有/ }).waitFor({ timeout: 20_000 })
    await logged(page, /driver5 (跟著出發了|已經在行程中)/, 10_000)
    await step('departed', 'driver4 出發，driver5 跟著出發（台下）。')

    await passenger.getByRole('button', { name: '今天我要搭' }).waitFor()
    await step('board', '0:00 乘客看到松山車站接近中的車。')

    await sendRequest(passenger)
    say('0:15 送出請求，正在等駕駛確認。')
    await logged(page, /driver5 婉拒了/, 30_000)
    await driver.getByRole('heading', { name: '有乘客要搭車' }).waitFor({ timeout: 30_000 })
    await step('request', '0:25 driver5 婉拒，改配給 driver4，駕駛畫面變黃。')

    await driver.getByRole('button', { name: '確認', exact: true }).click()
    // Only the confirmed screen has 我已上車; 分鐘後到 is also the placeholder while reassigning
    await passenger.getByRole('button', { name: '我已上車' }).waitFor({ timeout: 15_000 })
    await step('confirmed', '0:35 駕駛確認，乘客看到車牌與到達時間；車快轉到上車點（約 4 秒）。')

    await passenger.getByRole('heading', { name: '車已到上車點' }).waitFor({ timeout: CAR_ARRIVES_MS })
    await step('arrived', '0:40 車已到上車點。')
    // No 我已下車: driver4 fast-forwards to the destination and the trip ends by itself with the
    // ride (T64, DD-30). No screenshot in between, so a visible run's pause cannot miss the end.
    await passenger.getByRole('button', { name: '我已上車' }).click()
    say('0:41 乘客上車，車快轉到目的地。')
    await passenger.getByRole('heading', { name: '共乘完成' }).waitFor({ timeout: TRIP_ENDS_MS })
    await driver.getByText('這趟載了 1 位乘客').waitFor({ timeout: TRIP_ENDS_MS })
    await step('completed', '0:47 共乘完成，行程自己結束：駕駛「行程結束／這趟載了 1 位乘客」。')

    say(`Demo 跑完了，截圖在 ${SHOTS}`)
    await sleep(LINGER_MS)
  } finally {
    await browser.close()
  }
}

main().catch((err: unknown) => {
  say(`Demo 中斷：${err instanceof Error ? err.message : err}`)
  process.exitCode = 1
})
