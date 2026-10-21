import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { E2E_GO_PORTS } from '../../playwright.go.config'
import { useFakeGoogleMaps } from '../fakeGoogleMaps'

export const API = `http://localhost:${E2E_GO_PORTS.backend}/api`
export const DRIVER4 = { Authorization: 'Bearer driver:driver4' }
/** Only the people on stage pick it as their own tag: required, it sends the request to driver4. */
export const STAGE_TAG = '可帶寵物'

const appUrl = (port: number, account: string) => `http://localhost:${port}/?account=${account}`
export const DRIVER_URL = appUrl(E2E_GO_PORTS.driver, 'driver4')
export const PASSENGER_URL = appUrl(E2E_GO_PORTS.passenger, 'passenger1')
/** The apps with a fake Maps key: the place search is on (served by e2e/fakeGoogleMaps.ts). */
export const driverPlacesUrl = (account: string) => appUrl(E2E_GO_PORTS.driverPlaces, account)
export const passengerPlacesUrl = (account: string) => appUrl(E2E_GO_PORTS.passengerPlaces, account)

async function stageTagId(request: APIRequestContext): Promise<number> {
  const tags: { id: number; name: string }[] = await (await request.get(`${API}/tags`, { headers: DRIVER4 })).json()
  return tags.find((t) => t.name === STAGE_TAG)!.id
}

/**
 * Back to the Demo's start (DD-29). The reset keeps the tags people chose themselves, so driver4's
 * stage tag is dropped here too: nothing a test did is left for the next one. The reset also puts
 * driver4's trip settings back, auto-accept off included (DD-19).
 */
export async function resetDemo(request: APIRequestContext) {
  expect((await request.post(`${API}/demo/reset`)).status()).toBe(204)
  expect((await request.delete(`${API}/me/tags/${await stageTagId(request)}`, { headers: DRIVER4 })).ok()).toBe(true)
}

/** The simulator's part (DD-14): driver4 reports that it is coming up to 松山車站 from the south. */
export async function driveTowardsPickup(request: APIRequestContext) {
  for (const lat of [25.0465, 25.0475]) {
    expect((await request.post(`${API}/location`, { headers: DRIVER4, data: { lat, lng: 121.5779 } })).status()).toBe(201)
  }
}

/** Each app in its own browser context, like two phones (DD-24). */
export async function openApps(browser: Browser): Promise<{ driver: Page; passenger: Page }> {
  const driver = await (await browser.newContext()).newPage()
  const passenger = await (await browser.newContext()).newPage()
  await driver.goto(DRIVER_URL)
  await passenger.goto(PASSENGER_URL)
  return { driver, passenger }
}

/** A page of an app with the fake Places search, which knows one place outside the park and one inside. */
export async function openWithFakePlaces(browser: Browser, url: string): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext()
  await useFakeGoogleMaps(context)
  const page = await context.newPage()
  await page.goto(url)
  return { page, context }
}

/** driver4 picks the stage tag as its own (the departure screen is prefilled from its last trip). */
export async function pickStageTag(driver: Page) {
  const tags = driver.getByRole('group', { name: '我的標籤' })
  await driver.getByRole('button', { name: /我的標籤/ }).click()
  await tags.getByRole('button', { name: STAGE_TAG }).click()
  await expect(tags.getByRole('button', { name: STAGE_TAG })).toHaveAttribute('aria-pressed', 'true')
}

/** The passenger sends a request with the stage tag required, so only driver4 can take it (REQ-035, REQ-040). */
export async function requestWithStageTagRequired(passenger: Page) {
  await passenger.getByRole('button', { name: '今天我要搭' }).click()
  await passenger.getByRole('radiogroup', { name: `${STAGE_TAG}的篩選` }).getByRole('radio', { name: '強制' }).click()
  await passenger.getByRole('button', { name: '送出請求' }).click()
}
