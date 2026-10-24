import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { E2E_GO_PORTS } from '../../playwright.go.config'
import { useFakeGoogleMaps } from '../fakeGoogleMaps'

export const API = `http://localhost:${E2E_GO_PORTS.backend}/api`
export const DRIVER4 = { Authorization: 'Bearer driver:driver4' }
export const DRIVER5 = { Authorization: 'Bearer driver:driver5' }
/**
 * Only the people on stage carry both as their own tags: required, they send the request to driver4.
 * Of the simulated drivers, driver3 is seeded with both; the showcase's 開始 Demo drops its 安靜通勤
 * (T65), and resetDemo does the same here (the e2e has no showcase).
 */
export const STAGE_TAGS = ['不抽菸', '安靜通勤']
/** The stage tags as each side sees them (DD-42): a driver describing itself, a passenger filtering drivers. */
export const STAGE_TAG_WORDS = { driverSelf: ['我不抽菸', '開車喜歡安靜'], passengerFilter: ['不抽菸', '安靜坐車'] }
export const DRIVER3 = { Authorization: 'Bearer driver:driver3' }
export const PASSENGER1 = { Authorization: 'Bearer passenger:passenger1' }

const appUrl = (port: number, account: string) => `http://localhost:${port}/?account=${account}`
export const DRIVER_URL = appUrl(E2E_GO_PORTS.driver, 'driver4')
export const PASSENGER_URL = appUrl(E2E_GO_PORTS.passenger, 'passenger1')
/** The apps with a fake Maps key: the place search is on (served by e2e/fakeGoogleMaps.ts). */
export const driverPlacesUrl = (account: string) => appUrl(E2E_GO_PORTS.driverPlaces, account)
export const passengerPlacesUrl = (account: string) => appUrl(E2E_GO_PORTS.passengerPlaces, account)

/** The id of a tag by its internal name (`name` is never shown, DD-42). */
export async function tagId(request: APIRequestContext, name: string): Promise<number> {
  const tags: { id: number; name: string }[] = await (await request.get(`${API}/tags`, { headers: DRIVER4 })).json()
  return tags.find((t) => t.name === name)!.id
}

export async function stageTagIds(request: APIRequestContext): Promise<number[]> {
  const tags: { id: number; name: string }[] = await (await request.get(`${API}/tags`, { headers: DRIVER4 })).json()
  return STAGE_TAGS.map((name) => tags.find((t) => t.name === name)!.id)
}

/**
 * Back to the Demo's start (DD-29). The reset keeps the tags people chose themselves, so driver4's
 * stage tags are dropped here too, and driver5's, which a test may have picked as the second car,
 * and passenger1's own tags: nothing a test did is left for the next one. driver3 drops 安靜通勤,
 * as 開始 Demo does (T65), so no simulated car carries both stage tags. The reset also puts driver4's
 * trip settings back, auto-accept off included (DD-19), and cancels any trip still open.
 */
export async function resetDemo(request: APIRequestContext) {
  expect((await request.post(`${API}/demo/reset`)).status()).toBe(204)
  expect((await request.delete(`${API}/me/tags/${await tagId(request, '安靜通勤')}`, { headers: DRIVER3 })).ok()).toBe(true)
  for (const tagId of await stageTagIds(request)) {
    for (const headers of [DRIVER4, DRIVER5]) expect((await request.delete(`${API}/me/tags/${tagId}`, { headers })).ok()).toBe(true)
  }
  for (const name of ['不抽菸', '安靜通勤']) {
    expect((await request.delete(`${API}/me/tags/${await tagId(request, name)}`, { headers: PASSENGER1 })).ok()).toBe(true)
  }
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

/** driver4 picks the stage tags as its own, in its own words (the departure screen is prefilled from its last trip). */
export async function pickStageTags(driver: Page) {
  const tags = driver.getByRole('group', { name: '關於我和車' })
  await driver.getByRole('button', { name: /關於我和車/ }).click()
  for (const name of STAGE_TAG_WORDS.driverSelf) {
    await tags.getByRole('button', { name, exact: true }).click()
    await expect(tags.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
  }
}

/**
 * The passenger sends a request with both stage tags 一定要, so only driver5 and driver4 can take it
 * (REQ-035, REQ-040); `preferChat` also sets 可以聊天 to 最好, which neither has (REQ-047, T65).
 */
export async function requestWithStageTagsRequired(passenger: Page, { preferChat = false } = {}) {
  await passenger.getByRole('button', { name: '今天我要搭' }).click()
  const sheet = passenger.getByRole('dialog', { name: '送出搭車請求' })
  for (const name of STAGE_TAG_WORDS.passengerFilter) {
    await sheet.getByRole('radiogroup', { name: `${name}的篩選` }).getByRole('radio', { name: '一定要' }).click()
  }
  if (preferChat) await sheet.getByRole('radiogroup', { name: '可以聊天的篩選' }).getByRole('radio', { name: '最好' }).click()
  await passenger.getByRole('button', { name: '送出請求' }).click()
}

/**
 * driver5 as the second car, sent off through the API: the Demo reset cannot make driver5 a
 * first-time driver again (the reset keeps trips and the prefill comes from the latest one, DD-19, DD-29), so its departure screen differs from run to run.
 * It has the stage tags and auto-accept off, goes the same way as driver4, and reports a position
 * farther from 松山車站 than driver4's, so driver4 ranks first and driver5 second.
 */
export async function departDriver5Behind(request: APIRequestContext) {
  const pickups: { id: number; name: string }[] = await (await request.get(`${API}/pickup-points`, { headers: DRIVER5 })).json()
  const pickup = pickups.find((p) => p.name === '松山車站')!
  const destination = { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }
  const preview = await request.post(`${API}/driver/route-preview`, {
    headers: DRIVER5,
    data: { pickup_point_id: pickup.id, destination: { lat: destination.lat, lng: destination.lng } },
  })
  expect(preview.status()).toBe(200)
  const { preview_id } = await preview.json()
  for (const tagId of await stageTagIds(request)) {
    expect((await request.put(`${API}/me/tags/${tagId}`, { headers: DRIVER5 })).status()).toBe(204)
  }
  const trip = { pickup_point_id: pickup.id, destination, capacity: 3, auto_accept: false, preview_id }
  expect((await request.post(`${API}/driver/trips`, { headers: DRIVER5, data: trip })).status()).toBe(201)
  for (const lat of [25.0435, 25.0445]) {
    expect((await request.post(`${API}/location`, { headers: DRIVER5, data: { lat, lng: 121.5779 } })).status()).toBe(201)
  }
}
