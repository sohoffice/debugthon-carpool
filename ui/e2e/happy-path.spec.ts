import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { E2E_PORTS } from '../playwright.config'

const API = `http://localhost:${E2E_PORTS.mock}/api`
const DRIVER_URL = `http://localhost:${E2E_PORTS.driver}/?account=driver4`
const PASSENGER_URL = `http://localhost:${E2E_PORTS.passenger}/?account=passenger1`

/** Back to the seeded state, so no test leaves data behind for the next (UD-18). */
async function resetBackend(request: APIRequestContext) {
  expect((await request.post(`${API}/_mock/scenario`, { data: { scenario: 'normal' } })).ok()).toBe(true)
}

/** passenger1 rides to its usual destination (DD-19). */
const DROPOFF = '瑞光路 513 巷'
const DRIVER4_VEHICLE = { plate: 'ABC-0004', description: '藍色 Mazda 3' }

test.beforeEach(async ({ request }) => resetBackend(request))
test.afterEach(async ({ request }) => resetBackend(request))

/** Each app in its own browser context, like two phones (DD-24). */
async function openApps(browser: import('@playwright/test').Browser): Promise<{ driver: Page; passenger: Page }> {
  const driver = await (await browser.newContext()).newPage()
  const passenger = await (await browser.newContext()).newPage()
  await driver.goto(DRIVER_URL)
  await passenger.goto(PASSENGER_URL)
  return { driver, passenger }
}

test('happy path: depart, see supply, request, confirm, board, end the ride (REQ-065)', async ({ browser }) => {
  const { driver, passenger } = await openApps(browser)

  // REQ-015: the departure screen shows the day's destination, seats, pickup point and filters.
  await expect(driver.getByRole('heading', { name: '今天載人嗎？' })).toBeVisible()
  for (const label of ['上車點', '目的地', '可載人數', '只載']) await expect(driver.getByText(label, { exact: true })).toBeVisible()
  await expect(driver.getByRole('button', { name: /目的地\s*瑞光路 513 巷/ })).toBeVisible()
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible()

  // REQ-028, REQ-029: the chosen pickup point's count, soonest arrival and seats.
  const board = passenger.getByRole('region', { name: '松山車站的接近車輛' })
  await expect(board.getByText(/^\d+ 台車接近中$/)).toBeVisible()
  await expect(board.getByText(/^空位 \d+$/)).toBeVisible()
  await expect(board.getByRole('heading', { name: /最快 \d+ 分鐘到/ })).toBeVisible()

  // REQ-036: assigned at once; the mock ranks the car on stage first.
  await passenger.getByRole('button', { name: '今天我要搭' }).click()
  await passenger.getByRole('button', { name: '送出請求' }).click()
  await expect(passenger.getByRole('heading', { name: '正在等駕駛確認' })).toBeVisible()

  // REQ-049: the driver sees the pickup and drop-off and confirms.
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible()
  await expect(driver.getByRole('definition').filter({ hasText: '松山車站' })).toBeVisible()
  await expect(driver.getByRole('definition').filter({ hasText: DROPOFF })).toBeVisible()
  await driver.getByRole('button', { name: '確認' }).click()

  // The passenger is told (REQ-065) and marks boarding (REQ-068).
  await expect(passenger.getByText('分鐘後到').first()).toBeVisible()
  // REQ-052: where to get in and which car comes.
  await expect(passenger.getByText('在松山車站上車')).toBeVisible()
  await expect(passenger.getByText(DRIVER4_VEHICLE.plate, { exact: true })).toBeVisible()
  await expect(passenger.getByText(DRIVER4_VEHICLE.description, { exact: true })).toBeVisible()
  await passenger.getByRole('button', { name: '我已上車' }).click()
  await expect(passenger.getByRole('heading', { name: /^在.+下車$/ })).toBeVisible()
  await expect(driver.getByText('在車上')).toBeVisible()

  // REQ-067: the passenger ends the ride; it is gone from the driver's list too.
  await passenger.getByRole('button', { name: '我已下車，結束共乘' }).click()
  await expect(passenger.getByRole('heading', { name: '共乘完成' })).toBeVisible()
  await expect(driver.getByRole('region', { name: '乘客' })).toBeHidden()
})

test('no car: the passenger is told at once (REQ-036)', async ({ browser, request }) => {
  expect((await request.post(`${API}/_mock/scenario`, { data: { scenario: 'no_cars' } })).ok()).toBe(true)
  const { passenger } = await openApps(browser)

  await expect(passenger.getByRole('heading', { name: '10 分鐘內沒有車' })).toBeVisible()
  await passenger.getByRole('button', { name: '今天我要搭' }).click()
  await passenger.getByRole('button', { name: '送出請求' }).click()
  await expect(passenger.getByRole('heading', { name: '目前沒有可搭的車' })).toBeVisible()
})
