import { expect, test } from '@playwright/test'
import { driveTowardsPickup, openApps, pickStageTag, requestWithStageTagRequired, resetDemo } from './support'

// The Demo reset cancels the open trip and brings driver4's settings back, auto-accept off included (DD-19, DD-29).
test.beforeEach(async ({ request }) => resetDemo(request))
test.afterEach(async ({ request }) => resetDemo(request))

test('decline on Go: the request no longer waits for the declining driver (REQ-050)', async ({ browser, request }) => {
  const { driver, passenger } = await openApps(browser)
  await pickStageTag(driver)
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible()
  await driveTowardsPickup(request)
  await expect(passenger.getByRole('region', { name: '松山車站的接近車輛' }).getByText(/^\d+ 台車接近中$/)).toBeVisible()

  // The stage tag is required and only driver4 has it, so driver4 is the only car that can take the request.
  await requestWithStageTagRequired(passenger)
  await expect(passenger.getByRole('heading', { name: '正在等駕駛確認' })).toBeVisible()
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible()
  await driver.getByRole('button', { name: '婉拒' }).click()

  // This branch of REQ-050: no other car matches, so the passenger is told so instead of waiting on driver4.
  await expect(passenger.getByRole('heading', { name: '目前沒有可搭的車' })).toBeVisible()
  await expect(passenger.getByRole('heading', { name: '正在等駕駛確認' })).toBeHidden()
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeHidden()
  await Promise.all([driver.context().close(), passenger.context().close()])
})

test('auto-accept on Go: the passenger is confirmed without the driver doing anything (REQ-021, REQ-022)', async ({ browser, request }) => {
  const { driver, passenger } = await openApps(browser)
  await pickStageTag(driver)
  // REQ-021: the driver turns auto-accept on before departing.
  const autoAccept = driver.getByRole('switch', { name: '自動接受搭車請求' })
  await autoAccept.click()
  await expect(autoAccept).toBeChecked()
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible()
  await driveTowardsPickup(request)
  await expect(passenger.getByRole('region', { name: '松山車站的接近車輛' }).getByText(/^\d+ 台車接近中$/)).toBeVisible()

  // REQ-022: the request is confirmed on submit; the driver is never asked.
  await requestWithStageTagRequired(passenger)
  await expect(passenger.getByText('分鐘後到').first()).toBeVisible()
  await expect(passenger.getByRole('button', { name: '我已上車' })).toBeVisible()
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeHidden()
  await expect(driver.getByRole('button', { name: '確認' })).toBeHidden()
  await Promise.all([driver.context().close(), passenger.context().close()])
})
