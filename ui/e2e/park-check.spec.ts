import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { E2E_PORTS } from '../playwright.config'
import { INSIDE_PARK, OUTSIDE_PARK, useFakeGoogleMaps } from './fakeGoogleMaps'

const API = `http://localhost:${E2E_PORTS.mock}/api`
// driver5 never departed and passenger2 has no habitual data, so both start with no destination.
const DRIVER_URL = `http://localhost:${E2E_PORTS.driverPlaces}/?account=driver5`
const PASSENGER_URL = `http://localhost:${E2E_PORTS.passengerPlaces}/?account=passenger2`
const OUTSIDE_NOTE = `${OUTSIDE_PARK.name}不在內湖科學園區內，請換一個地點。`

/** Back to the seeded state, so no test leaves data behind for the next (UD-18). */
async function resetBackend(request: APIRequestContext) {
  expect((await request.post(`${API}/_mock/scenario`, { data: { scenario: 'normal' } })).ok()).toBe(true)
}

test.beforeEach(async ({ request }) => resetBackend(request))
test.afterEach(async ({ request }) => resetBackend(request))

async function openWithFakePlaces(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext()
  await useFakeGoogleMaps(context)
  const page = await context.newPage()
  await page.goto(url)
  return page
}

async function choosePlace(page: Page, name: string) {
  await page.getByRole('searchbox', { name: '目的地地址' }).fill(name)
  await page.getByRole('list', { name: '符合的地點' }).getByRole('button', { name: new RegExp(name) }).click()
}

test('driver: a destination outside the park is flagged and cannot be departed to (REQ-001, DD-32)', async ({ browser }) => {
  const driver = await openWithFakePlaces(browser, DRIVER_URL)
  await expect(driver.getByRole('heading', { name: '第一次出發' })).toBeVisible()
  await driver.getByRole('radio', { name: '松山車站' }).click()

  await choosePlace(driver, OUTSIDE_PARK.name)
  await expect(driver.getByText(OUTSIDE_NOTE)).toBeVisible()
  await expect(driver.getByRole('button', { name: /目的地\s*未填/ })).toBeVisible()
  await expect(driver.getByRole('button', { name: '我出發了' })).toBeDisabled()

  // Choosing a place in the park clears the note and departs.
  await choosePlace(driver, INSIDE_PARK.name)
  await expect(driver.getByText(OUTSIDE_NOTE)).toBeHidden()
  await expect(driver.getByRole('button', { name: new RegExp(`目的地\\s*${INSIDE_PARK.name}`) })).toBeVisible()
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible()
})

test('passenger: a destination outside the park is flagged and no request can be sent (REQ-001, DD-32)', async ({ browser }) => {
  const passenger = await openWithFakePlaces(browser, PASSENGER_URL)
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
})
