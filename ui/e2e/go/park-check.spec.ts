import { expect, test, type Page } from '@playwright/test'
import { INSIDE_PARK, OUTSIDE_PARK } from '../fakeGoogleMaps'
import { driverPlacesUrl, openWithFakePlaces, passengerPlacesUrl, resetDemo } from './support'

// passenger2 has no habitual data, so it starts with no destination. The driver test starts from driver4's
// prefilled departure, which the Demo reset restores (DD-19): no driver can be a first-time driver again
// once it has departed (trips are kept, DD-06), and the reassign test departs driver5. With a destination
// already set, an outside place is refused and the set destination stays, so the departure button stays
// on; the first-time driver who has no destination, where 「我出發了」 is disabled, is covered by the mock e2e.
const OUTSIDE_NOTE = `${OUTSIDE_PARK.name}不在內湖科學園區內，請換一個地點。`

test.beforeEach(async ({ request }) => resetDemo(request))
test.afterEach(async ({ request }) => resetDemo(request))

async function choosePlace(page: Page, name: string) {
  await page.getByRole('searchbox', { name: '目的地地址' }).fill(name)
  await page.getByRole('list', { name: '符合的地點' }).getByRole('button', { name: new RegExp(name) }).click()
}

test('driver on Go: a destination outside the park is flagged and not taken (REQ-001, DD-32)', async ({ browser }) => {
  const { page: driver, context } = await openWithFakePlaces(browser, driverPlacesUrl('driver4'))
  await expect(driver.getByRole('heading', { name: '今天載人嗎？' })).toBeVisible()
  await driver.getByRole('button', { name: /目的地\s*瑞光路 513 巷/ }).click()

  await choosePlace(driver, OUTSIDE_PARK.name)
  await expect(driver.getByText(OUTSIDE_NOTE)).toBeVisible()
  // The outside place did not replace the destination, so the driver cannot depart to it.
  await expect(driver.getByRole('button', { name: /目的地\s*瑞光路 513 巷/ })).toBeVisible()
  await expect(driver.getByRole('button', { name: new RegExp(`目的地\\s*${OUTSIDE_PARK.name}`) })).toBeHidden()

  // Choosing a place in the park clears the note, becomes the destination and departs.
  await choosePlace(driver, INSIDE_PARK.name)
  await expect(driver.getByText(OUTSIDE_NOTE)).toBeHidden()
  await expect(driver.getByRole('button', { name: new RegExp(`目的地\\s*${INSIDE_PARK.name}`) })).toBeVisible()
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible()
  await context.close()
})

test('passenger on Go: a destination outside the park is flagged and no request can be sent (REQ-001, DD-32)', async ({ browser }) => {
  const { page: passenger, context } = await openWithFakePlaces(browser, passengerPlacesUrl('passenger2'))
  await expect(passenger.getByRole('heading', { name: '要去內科哪裡？' })).toBeVisible()

  await choosePlace(passenger, OUTSIDE_PARK.name)
  await expect(passenger.getByText(OUTSIDE_NOTE)).toBeVisible()
  await expect(passenger.getByText('先填目的地，這裡會列出附近的公車站。')).toBeVisible()
  await expect(passenger.getByRole('button', { name: '查看接近的車' })).toBeDisabled()

  // Choosing a place in the park clears the note; with a stop the request goes out.
  await choosePlace(passenger, INSIDE_PARK.name)
  await expect(passenger.getByText(OUTSIDE_NOTE)).toBeHidden()
  await passenger.getByRole('group', { name: '可以下車的公車站' }).getByRole('button').first().click()
  await passenger.getByRole('button', { name: '查看接近的車' }).click()
  await expect(passenger.getByText(`到 ${INSIDE_PARK.name}`)).toBeVisible()
  await passenger.getByRole('button', { name: '今天我要搭' }).click()
  await passenger.getByRole('button', { name: '送出請求' }).click()
  await expect(passenger.getByRole('dialog', { name: '送出搭車請求' })).toBeHidden()
  await context.close()
})
