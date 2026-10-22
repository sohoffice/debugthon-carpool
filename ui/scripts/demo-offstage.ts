// The Demo's off-stage part (T18E, docs/demo-script.md), so the speaker only works the two phones
// on the showcase: driver4 and driver5 take the required tag, driver5 departs, the simulator runs
// (DD-14), the terminal says when driver4 should depart and when the 2 minutes start, and driver5
// declines every request it gets, which reassigns it to driver4 (REQ-049).
// Runs against `just demo` (backend :8080, driver UI :5173); it never resets the Demo or starts
// a server of its own. Ctrl-C stops it. Not a test.
import { chromium } from '@playwright/test'
import { selectStageTag, STAGE_ACCOUNTS, STAGE_TAG } from './stageTag.ts'

const API = process.env.DEMO_API ?? 'http://localhost:8080/api'
const DRIVER_APP = process.env.DEMO_DRIVER_APP ?? 'http://localhost:5173'
/** Default seconds driver5 leads driver4, so it is nearer the pickup point and gets the request first. */
const DEFAULT_LEAD_S = 10
const POLL_MS = 1000

type Trip = { id: number; destination: { name: string; lat: number; lng: number }; pickup_point: { id: number }; passed_pickup: boolean }
type Requests = { trip_id: number | null; pending: { id: number; passenger_name: string }[] }
type Defaults = { pickup_point_id: number | null; destination: Trip['destination'] | null }

const say = (text: string) => console.log(`${new Date().toLocaleTimeString('zh-TW', { hour12: false })}  ${text}`)

async function api<T>(account: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer driver:${account}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** driver5 departs to driver4's destination, unless it is already driving. */
async function departDriver5() {
  const running = await api<Requests>('driver5', 'GET', '/driver/requests')
  if (running.body.trip_id !== null) {
    say(`driver5 已經在行程中（行程 ${running.body.trip_id}），沿用這趟。`)
    return
  }
  // Same destination as driver4's prefilled one, so the simulator's driver5 path reaches it too.
  const defaults = (await api<Defaults>('driver4', 'GET', '/driver/trips/defaults')).body
  const destination = defaults.destination ?? { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }
  const trip = await api<Trip>('driver5', 'POST', '/driver/trips', {
    pickup_point_id: defaults.pickup_point_id ?? 1,
    destination,
    capacity: 3,
    auto_accept: false,
    tag_filters: [],
  })
  if (trip.status !== 201) throw new Error(`driver5 出發失敗：${trip.status} ${JSON.stringify(trip.body)}`)
  say(`driver5 帶「${STAGE_TAG}」出發了，往${destination.name}（台下，觀眾看不到）。`)
}

/** Lead in seconds, from the first argument or DEMO_LEAD_S; anything but a non-negative integer is an error. */
function parseLead(): number {
  const raw = process.argv[2] ?? process.env.DEMO_LEAD_S
  if (raw === undefined || raw === '') return DEFAULT_LEAD_S
  if (!/^\d+$/.test(raw)) throw new Error(`延遲秒數必須是非負整數，收到「${raw}」`)
  return Number(raw)
}

async function main() {
  // Validate first, so a bad argument never lets driver5 depart.
  const LEAD_S = parseLead()
  const ping = await fetch(`${API}/ping`).catch(() => null)
  if (!ping?.ok) throw new Error(`連不到後端 ${API}，請先執行 just demo`)
  const app = await fetch(DRIVER_APP).catch(() => null)
  if (!app?.ok) throw new Error(`連不到駕駛介面 ${DRIVER_APP}，請先執行 just demo`)

  // Both stage drivers carry the required tag, else the request has no second car (T34).
  for (const account of STAGE_ACCOUNTS) await selectStageTag(api, account)
  say(`driver4、driver5 都帶「${STAGE_TAG}」。`)
  await departDriver5()

  // The simulator page, headless. Its Google requests are blocked: this page shows no map, and
  // the Maps quota is left to the showcase.
  // Ctrl-C is ours: stop the loop and close the browser here, not inside Playwright.
  const browser = await chromium.launch({ handleSIGINT: false })
  try {
    const context = await browser.newContext()
    await context.route(/googleapis\.com|gstatic\.com/, (route) => route.abort())
    const sim = await context.newPage()
    await sim.goto(`${DRIVER_APP}/?debug=1&account=driver1`)
    await sim.getByRole('button', { name: '除錯' }).click()
    await sim.getByRole('button', { name: '開始模擬' }).click()
    say('模擬器開始了：模擬車與 driver5 開始移動。')

    let stopping = false
    process.on('SIGINT', () => {
      stopping = true
    })
    await runLoop(LEAD_S, () => stopping)
  } finally {
    // Also on an error, else the headless browser keeps the process alive and Ctrl-C is ignored.
    await browser.close()
  }
  say('台下操作結束。Demo 的資料沒有動，後端與介面照常執行。')
}

/** Polls until Ctrl-C: cues for the speaker, and driver5 declines what it gets. */
async function runLoop(leadS: number, stopping: () => boolean) {
  const departAt = Date.now() + leadS * 1000
  let toldDepart = false
  let toldStart = false
  let toldPassed = false
  let toldEnded = false
  let driver4Seen = false
  const declined = new Set<number>()
  say(`${leadS} 秒後請 driver4 出發（展示頁左邊的手機按「我出發了」）。`)

  let offline = false

  // One round; a failed round is retried on the next tick, so a backend restart needs no rerun.
  const poll = async () => {
    if (!toldDepart && Date.now() >= departAt) {
      say('▶ 現在請 driver4 出發：展示頁左邊的手機確認「我的標籤」有「女性友善」，按「我出發了」。')
      toldDepart = true
    }
    const d4 = (await api<Requests>('driver4', 'GET', '/driver/requests')).body
    if (!driver4Seen && d4.trip_id !== null) {
      driver4Seen = true
      say('driver4 出發了。')
    }
    // Both simulated paths start about 500 m before the pickup, so the stage can start right away.
    if (driver4Seen && !toldStart) {
      say('▶ 現在可以開始台上的 2 分鐘：從乘客看供給看板開始（劇本 0:00）。')
      toldStart = true
    }

    // driver5 turns down whatever it gets, so the request goes on to driver4 on stage.
    const d5 = (await api<Requests>('driver5', 'GET', '/driver/requests')).body
    for (const request of d5.pending) {
      if (declined.has(request.id)) continue
      const answer = await api('driver5', 'POST', `/driver/requests/${request.id}/decline`)
      declined.add(request.id)
      say(`driver5 婉拒了${request.passenger_name}的請求（${answer.status}），平台改配給下一台車。`)
    }
    if (d5.trip_id !== null && !toldPassed) {
      const trip = (await api<Trip>('driver5', 'GET', `/trips/${d5.trip_id}`)).body
      if (trip.passed_pickup) {
        say('注意：driver5 已經過上車點。現在送出的請求會直接配給 driver4，跳過婉拒那段，照常往下演。')
        toldPassed = true
      }
    }
    if (d5.trip_id === null && !toldEnded) {
      say('driver5 沒有進行中的行程了（Demo 重設或已到目的地）。要再演一次：重設後按 Ctrl-C，重新執行本指令。')
      toldEnded = true
    }
  }

  while (!stopping()) {
    try {
      await poll()
      if (offline) say('後端恢復了，繼續執行。')
      offline = false
    } catch (err) {
      if (!offline) say(`連不到後端（${err instanceof Error ? err.message : err}），每秒重試；後端恢復後會自己繼續。`)
      offline = true
    }
    await sleep(POLL_MS)
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
