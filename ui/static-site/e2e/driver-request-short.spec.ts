import { expect, test, type Page } from '@playwright/test'
import { useFakeGoogleMaps } from '../../e2e/fakeGoogleMaps'
import {
  expectButtonsOnScreen,
  expectMapReadableOrAbsent,
  MIN_MAP_HEIGHT,
  requestScreenLayout,
  SHORT_SIZES,
  TALL_SIZE,
} from '../../e2e/requestScreenFit'
import { SITE_URL } from '../playwright.config'

// T76: the driver tour's 有乘客要搭車 (SC-D3) under the coach bar, on short phone screens. The
// tour's passenger rides to 瑞光路 513 巷, two lines at 375px with the full sizes.
const DRIVER = `${SITE_URL}driver/index.html`
const STEP_TIMEOUT_MS = 30_000

async function openRequest(page: Page) {
  await page.goto(DRIVER)
  await page.getByRole('button', { name: '我出發了' }).click()
  await expect(page.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
}

/** 375×548 leaves the screen about 465px under the coach bar: no room for a map (T76). */
const ROOM_FOR_MAP = (size: { height: number }) => size.height > 548

for (const size of [...SHORT_SIZES, TALL_SIZE]) {
  test(`${size.width}×${size.height}: both buttons on screen; map ≥ ${MIN_MAP_HEIGHT}px or none (UD-05, UD-29)`, async ({ page }) => {
    await useFakeGoogleMaps(page.context())
    await page.setViewportSize(size)
    await openRequest(page)
    const layout = await requestScreenLayout(page)
    await expectButtonsOnScreen(page, layout, size.height)
    expectMapReadableOrAbsent(layout)
    expect(layout.mapDrawn).toBe(ROOM_FOR_MAP(size))
  })
}

test('375×667 with no map: the buttons sit where they do with one (UD-05, UD-29)', async ({ browser }) => {
  const size = SHORT_SIZES[1]
  const withMap = await browser.newPage({ viewport: size })
  await useFakeGoogleMaps(withMap.context())
  await openRequest(withMap)
  const mapped = await requestScreenLayout(withMap)
  expect(mapped.mapDrawn).toBe(true)

  // The Maps script fails to load: the map block is left out (UD-29).
  const failed = await browser.newPage({ viewport: size })
  await failed.context().route(/googleapis\.com|gstatic\.com/, (route) => route.abort())
  await openRequest(failed)
  const plain = await requestScreenLayout(failed)
  expect(plain.mapDrawn).toBe(false)
  await expect(failed.getByText(/地圖/)).toHaveCount(0)
  expect({ confirm: plain.confirm, decline: plain.decline }).toEqual({ confirm: mapped.confirm, decline: mapped.decline })
})
