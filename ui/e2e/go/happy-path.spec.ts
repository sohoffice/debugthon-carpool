import { expect, test } from '@playwright/test'
import { driveTowardsPickup, openApps, PASSENGER_URL, pickStageTag, requestWithStageTagRequired, resetDemo } from './support'

/** passenger1 rides to its usual destination (DD-19). */
const DROPOFF = '瑞光路 513 巷'
const DRIVER4_VEHICLE = { plate: 'DEF-4567', description: '藍色 Mazda 3' }

test.beforeEach(async ({ request }) => resetDemo(request))
test.afterEach(async ({ request }) => resetDemo(request))

test('happy path on Go: depart, see supply, request, confirm, board, end the ride (REQ-065)', async ({ browser, request }) => {
  const { driver, passenger } = await openApps(browser)

  // REQ-015, REQ-016: the departure screen comes prefilled from driver4's seeded last trip.
  await expect(driver.getByRole('heading', { name: '今天載人嗎？' })).toBeVisible()
  await expect(driver.getByRole('button', { name: /目的地\s*瑞光路 513 巷/ })).toBeVisible()
  await pickStageTag(driver)
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible()

  // The simulator's part (DD-14).
  await driveTowardsPickup(request)

  // REQ-028, REQ-029: passenger1 opens on the board of the nearest pickup point.
  const board = passenger.getByRole('region', { name: '松山車站的接近車輛' })
  await expect(board.getByText(/^\d+ 台車接近中$/)).toBeVisible()
  await expect(board.getByText(/^空位 \d+$/)).toBeVisible()
  await expect(board.getByRole('heading', { name: /最快 \d+ 分鐘到/ })).toBeVisible()
  // REQ-063: the ETA is an estimate (no Maps key) and the cars are simulated; both say so.
  await expect(board.getByRole('heading', { name: /最快 \d+ 分鐘到/ }).getByText('估算', { exact: true })).toBeVisible()
  await expect(passenger.getByText('模擬車輛', { exact: true })).toBeVisible()

  // REQ-035, REQ-036, REQ-040: with the stage tag required, the request goes to driver4 and waits for it.
  await requestWithStageTagRequired(passenger)
  await expect(passenger.getByRole('heading', { name: '正在等駕駛確認' })).toBeVisible()

  // REQ-049: the driver sees the pickup and drop-off and confirms.
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible()
  await expect(driver.getByRole('definition').filter({ hasText: '松山車站' })).toBeVisible()
  await expect(driver.getByRole('definition').filter({ hasText: DROPOFF })).toBeVisible()
  await driver.getByRole('button', { name: '確認' }).click()

  // The passenger is told (REQ-065) and marks boarding (REQ-068).
  await expect(passenger.getByText('分鐘後到').first()).toBeVisible()
  // REQ-052: where to get in and which car comes (driver4's seeded vehicle).
  await expect(passenger.getByText('在松山車站上車')).toBeVisible()
  await expect(passenger.getByText(DRIVER4_VEHICLE.plate, { exact: true })).toBeVisible()
  await expect(passenger.getByText(DRIVER4_VEHICLE.description, { exact: true })).toBeVisible()
  // REQ-063: the confirmed screen marks the estimate and the simulated car too.
  await expect(passenger.getByRole('heading', { name: /分鐘後到/ }).getByText('估算', { exact: true })).toBeVisible()
  await expect(passenger.getByText('模擬車輛', { exact: true })).toBeVisible()
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
