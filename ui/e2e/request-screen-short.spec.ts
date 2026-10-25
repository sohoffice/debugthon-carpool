import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { E2E_PORTS } from '../playwright.config'
import { useFakeGoogleMaps } from './fakeGoogleMaps'
import {
  expectButtonsOnScreen,
  expectMapReadableOrAbsent,
  MIN_MAP_HEIGHT,
  requestScreenLayout,
  SHORT_SIZES,
  TALL_SIZE,
  type RequestScreenLayout,
} from './requestScreenFit'

// T76: the driver's 有請求 screen (SC-D3) on short phone screens, with and without a map (UD-05, UD-29).
const API = `http://localhost:${E2E_PORTS.mock}/api`
const NO_KEY = `http://localhost:${E2E_PORTS.driver}/?account=driver4`
const WITH_MAP = `http://localhost:${E2E_PORTS.driverPlaces}/?account=driver4`
/** Near 松山車站, where passenger1 waits. */
const AT_PICKUP = { lat: 25.0498, lng: 121.5782 }
/** Inside the park, with a name that takes two lines at full size even at 390px (T76 acceptance). */
const LONG_DESTINATION = { name: '瑞光路 513 巷 22 弄 7 號', lat: 25.0803579, lng: 121.5678812 }

async function resetBackend(request: APIRequestContext) {
  expect((await request.post(`${API}/_mock/scenario`, { data: { scenario: 'normal' } })).ok()).toBe(true)
}

test.beforeEach(async ({ request }) => resetBackend(request))
test.afterEach(async ({ request }) => resetBackend(request))

/** driver4 departs; passenger1 asks to ride to `destination` (its usual one when left out). */
async function openRequest(browser: Browser, request: APIRequestContext, url: string, size: { width: number; height: number }, destination?: typeof LONG_DESTINATION): Promise<Page> {
  const context = await browser.newContext({ viewport: size })
  if (url === WITH_MAP) await useFakeGoogleMaps(context)
  const page = await context.newPage()
  await page.goto(url)
  await page.getByRole('button', { name: '我出發了' }).click()
  await expect(page.getByRole('heading', { name: /目前沒有/ })).toBeVisible()
  const sent = await request.post(`${API}/passenger/requests`, {
    headers: { Authorization: 'Bearer passenger:passenger1' },
    data: { pickup_point_id: 1, location: AT_PICKUP, ...(destination ? { destination } : {}) },
  })
  expect(sent.ok()).toBe(true)
  return page
}

const position = (l: RequestScreenLayout) => ({ confirm: l.confirm, decline: l.decline })

for (const size of [...SHORT_SIZES, TALL_SIZE]) {
  for (const destination of [undefined, LONG_DESTINATION]) {
    const label = `${size.width}×${size.height}${destination ? ', two-line drop-off' : ''}`
    test(`${label}: map ≥ ${MIN_MAP_HEIGHT}px or none, both buttons on screen, same with no key (UD-05, UD-29)`, async ({ browser, request }) => {
      const withMap = await openRequest(browser, request, WITH_MAP, size, destination)
      const mapped = await requestScreenLayout(withMap)
      await expectButtonsOnScreen(withMap, mapped, size.height)
      expectMapReadableOrAbsent(mapped)
      // There is room for one on all these sizes; the static site's 375×548 is the one with none.
      expect(mapped.map).toBeGreaterThanOrEqual(MIN_MAP_HEIGHT)
      await withMap.context().close()
      await resetBackend(request)

      const noKey = await openRequest(browser, request, NO_KEY, size, destination)
      const plain = await requestScreenLayout(noKey)
      expect(plain.mapDrawn).toBe(false)
      // No hint text in the map's place (UD-29).
      await expect(noKey.getByText(/地圖/)).toHaveCount(0)
      expect(position(plain)).toEqual(position(mapped))
      await noKey.context().close()
    })
  }
}

test('390×844: the full sizes, as before T76 (names 48px, 確認 112px, 婉拒 72px)', async ({ browser, request }) => {
  const page = await openRequest(browser, request, WITH_MAP, TALL_SIZE)
  const layout = await requestScreenLayout(page)
  expect(layout.nameSize).toBe(48)
  expect(layout.confirm.height).toBe(112)
  expect(layout.decline.height).toBe(72)
  await page.context().close()
})

test('390×664: the short sizes (names 36px, 確認 88px, 婉拒 64px)', async ({ browser, request }) => {
  const page = await openRequest(browser, request, WITH_MAP, SHORT_SIZES[0])
  const layout = await requestScreenLayout(page)
  expect(layout.nameSize).toBe(36)
  expect(layout.confirm.height).toBe(88)
  expect(layout.decline.height).toBe(64)
  await page.context().close()
})
