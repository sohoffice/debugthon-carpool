import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { E2E_GO_PORTS } from '../../playwright.go.config'

const API = `http://localhost:${E2E_GO_PORTS.backend}/api`
const DRIVER_URL = `http://localhost:${E2E_GO_PORTS.driver}/?account=driver4`
const PASSENGER_URL = `http://localhost:${E2E_GO_PORTS.passenger}/?account=passenger1`
const DRIVER4 = { Authorization: 'Bearer driver:driver4' }
/** Only the people on stage pick it as their own tag: required, it sends the request to driver4. */
const STAGE_TAG = '可帶寵物'

async function stageTagId(request: APIRequestContext): Promise<number> {
  const tags: { id: number; name: string }[] = await (await request.get(`${API}/tags`, { headers: DRIVER4 })).json()
  return tags.find((t) => t.name === STAGE_TAG)!.id
}

/**
 * Back to the Demo's start (DD-29). The reset keeps the tags people chose themselves, so driver4's
 * stage tag is dropped here too: nothing a test did is left for the next one.
 */
async function resetDemo(request: APIRequestContext) {
  expect((await request.post(`${API}/demo/reset`)).status()).toBe(204)
  expect((await request.delete(`${API}/me/tags/${await stageTagId(request)}`, { headers: DRIVER4 })).ok()).toBe(true)
}

test.beforeEach(async ({ request }) => resetDemo(request))
test.afterEach(async ({ request }) => resetDemo(request))

/** Each app in its own browser context, like two phones (DD-24). */
async function openApps(browser: Browser): Promise<{ driver: Page; passenger: Page }> {
  const driver = await (await browser.newContext()).newPage()
  const passenger = await (await browser.newContext()).newPage()
  await driver.goto(DRIVER_URL)
  await passenger.goto(PASSENGER_URL)
  return { driver, passenger }
}

test('happy path on Go: depart, see supply, request, confirm, board, end the ride (REQ-065)', async ({ browser, request }) => {
  const { driver, passenger } = await openApps(browser)

  // REQ-015, REQ-016: the departure screen comes prefilled from driver4's seeded last trip.
  await expect(driver.getByRole('heading', { name: '今天載人嗎？' })).toBeVisible()
  await expect(driver.getByRole('button', { name: /目的地\s*瑞光路 513 巷/ })).toBeVisible()
  await driver.getByRole('button', { name: /我的標籤/ }).click()
  await driver.getByRole('group', { name: '我的標籤' }).getByRole('button', { name: STAGE_TAG }).click()
  await expect(driver.getByRole('group', { name: '我的標籤' }).getByRole('button', { name: STAGE_TAG })).toHaveAttribute('aria-pressed', 'true')
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible()

  // The simulator's part (DD-14): driver4 reports that it is coming up to 松山車站 from the south.
  for (const lat of [25.0465, 25.0475]) {
    expect((await request.post(`${API}/location`, { headers: DRIVER4, data: { lat, lng: 121.5779 } })).status()).toBe(201)
  }

  // REQ-028, REQ-029: passenger1 opens on the board of the nearest pickup point.
  const board = passenger.getByRole('region', { name: '松山車站的接近車輛' })
  await expect(board.getByText(/^\d+ 台車接近中$/)).toBeVisible()
  await expect(board.getByRole('heading', { name: /最快 \d+ 分鐘到/ })).toBeVisible()

  // REQ-036, REQ-046: with the stage tag required, the request goes to driver4 and waits for it.
  await passenger.getByRole('button', { name: '今天我要搭' }).click()
  await passenger.getByRole('radiogroup', { name: `${STAGE_TAG}的篩選` }).getByRole('radio', { name: '強制' }).click()
  await passenger.getByRole('button', { name: '送出請求' }).click()
  await expect(passenger.getByRole('heading', { name: '正在等駕駛確認' })).toBeVisible()

  // REQ-049: the driver sees the pickup and drop-off and confirms.
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible()
  await expect(driver.getByRole('definition').filter({ hasText: '松山車站' })).toBeVisible()
  await driver.getByRole('button', { name: '確認' }).click()

  // The passenger is told (REQ-065) and marks boarding (REQ-068).
  await expect(passenger.getByText('分鐘後到').first()).toBeVisible()
  await passenger.getByRole('button', { name: '我已上車' }).click()
  await expect(passenger.getByRole('heading', { name: /^在.+下車$/ })).toBeVisible()
  await expect(driver.getByText('在車上')).toBeVisible()

  // REQ-067: the passenger ends the ride; it is gone from the driver's list too.
  await passenger.getByRole('button', { name: '我已下車，結束共乘' }).click()
  await expect(passenger.getByRole('heading', { name: '共乘完成' })).toBeVisible()
  await expect(driver.getByRole('region', { name: '乘客' })).toBeHidden()
  await Promise.all([driver.context().close(), passenger.context().close()])
})

test('no car on Go: the passenger is told at once (REQ-036)', async ({ browser }) => {
  // Next to 台北世貿中心, where no trip of the Demo passes.
  const context = await browser.newContext()
  await context.addInitScript(() => localStorage.setItem('carpool.position.passenger1', 'wtc'))
  const passenger = await context.newPage()
  await passenger.goto(PASSENGER_URL)

  await expect(passenger.getByRole('heading', { name: '10 分鐘內沒有車' })).toBeVisible()
  await passenger.getByRole('button', { name: '今天我要搭' }).click()
  await passenger.getByRole('button', { name: '送出請求' }).click()
  await expect(passenger.getByRole('heading', { name: '目前沒有可搭的車' })).toBeVisible()
  await context.close()
})
