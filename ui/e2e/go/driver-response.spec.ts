import { expect, test } from '@playwright/test'
import { E2E_GO_PORTS } from '../../playwright.go.config'
import { departDriver5Behind, driveTowardsPickup, openApps, pickStageTags, requestWithStageTagsRequired, resetDemo } from './support'

const DRIVER5_URL = `http://localhost:${E2E_GO_PORTS.driver}/?account=driver5`

// The Demo reset cancels the open trip and brings driver4's settings back, auto-accept off included (DD-19, DD-29).
test.beforeEach(async ({ request }) => resetDemo(request))
test.afterEach(async ({ request }) => resetDemo(request))

test('decline on Go, no other car: the request no longer waits for the declining driver (REQ-050)', async ({ browser, request }) => {
  const { driver, passenger } = await openApps(browser)
  await pickStageTags(driver)
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible()
  await driveTowardsPickup(request)
  await expect(passenger.getByRole('region', { name: '松山車站的接近車輛' }).getByText(/^\d+ 台車接近中$/)).toBeVisible()

  // The stage tags are required and only driver4 has both, so driver4 is the only car that can take the request.
  await requestWithStageTagsRequired(passenger)
  await expect(passenger.getByRole('heading', { name: '正在等駕駛確認' })).toBeVisible()
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible()
  await driver.getByRole('button', { name: '婉拒' }).click()

  // This branch of REQ-050: no other car matches, so the passenger is told so instead of waiting on driver4.
  await expect(passenger.getByRole('heading', { name: '目前沒有可搭的車' })).toBeVisible()
  await expect(passenger.getByRole('heading', { name: '正在等駕駛確認' })).toBeHidden()
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeHidden()
  await Promise.all([driver.context().close(), passenger.context().close()])
})

test('decline on Go, another car: the request goes to the next car (REQ-050, REQ-053)', async ({ browser, request }) => {
  const { driver, passenger } = await openApps(browser)
  const driver5 = await (await browser.newContext()).newPage()
  await driver5.goto(DRIVER5_URL)
  await pickStageTags(driver)
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible()
  await driveTowardsPickup(request)
  await departDriver5Behind(request)
  await expect(passenger.getByRole('region', { name: '松山車站的接近車輛' }).getByText(/^2 台車接近中$/)).toBeVisible()

  // Both cars carry the required stage tags and driver4 is nearer, so the request goes to driver4 first.
  await requestWithStageTagsRequired(passenger)
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible()
  await expect(driver5.getByRole('heading', { name: '有乘客要搭車' })).toBeHidden()
  await driver.getByRole('button', { name: '婉拒' }).click()

  // Reassigned: driver5 is asked; the passenger is told for a moment, then keeps waiting, told why.
  await expect(driver5.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible()
  await expect(passenger.getByRole('heading', { name: '駕駛無法載你' })).toBeVisible()
  await expect(passenger.getByRole('heading', { name: '正在等駕駛確認' })).toBeVisible()
  await expect(passenger.getByText('上一位駕駛無法載你，已改配下一台車。')).toBeVisible()
  await expect(passenger.getByRole('heading', { name: '目前沒有可搭的車' })).toBeHidden()

  // driver5 confirms: the passenger is confirmed on driver5's car, not driver4's.
  await driver5.getByRole('button', { name: '確認' }).click()
  await expect(passenger.getByText('分鐘後到').first()).toBeVisible()
  await expect(passenger.getByText('ABC-0005', { exact: true })).toBeVisible()
  await expect(passenger.getByText('紅色 Toyota Yaris', { exact: true })).toBeVisible()
  await expect(passenger.getByText('ABC-0004', { exact: true })).toBeHidden()
  await Promise.all([driver.context().close(), driver5.context().close(), passenger.context().close()])
})

test('auto-accept on Go: the passenger is confirmed without the driver doing anything (REQ-021, REQ-022)', async ({ browser, request }) => {
  const { driver, passenger } = await openApps(browser)
  await pickStageTags(driver)
  // REQ-021: the driver turns auto-accept on before departing.
  const autoAccept = driver.getByRole('switch', { name: '自動接受搭車請求' })
  await autoAccept.click()
  await expect(autoAccept).toBeChecked()
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible()
  await driveTowardsPickup(request)
  await expect(passenger.getByRole('region', { name: '松山車站的接近車輛' }).getByText(/^\d+ 台車接近中$/)).toBeVisible()

  // REQ-022, DD-33: the driver never touches the screen. The backend leaves the request waiting;
  // the driver UI sees it on its next poll and confirms it, and the passenger sees that on its
  // own next poll, so allow two poll intervals and some margin.
  await requestWithStageTagsRequired(passenger)
  await expect(passenger.getByText('分鐘後到').first()).toBeVisible({ timeout: 15_000 })
  await expect(passenger.getByRole('button', { name: '我已上車' })).toBeVisible()
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeHidden()
  await expect(driver.getByRole('button', { name: '確認' })).toBeHidden()
  await Promise.all([driver.context().close(), passenger.context().close()])
})
