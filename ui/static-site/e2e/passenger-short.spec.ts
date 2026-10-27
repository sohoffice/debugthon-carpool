import { expect, test, type Locator, type Page } from '@playwright/test'
import { SITE_URL } from '../playwright.config'

// T77: the passenger tour's 送出搭車請求 sheet (SC-P3) and 共乘完成 (SC-P9) under the coach bar, on
// short phone screens: the buttons stay put at the bottom and only the content above them scrolls.
const PASSENGER = `${SITE_URL}passenger/index.html`
const STEP_TIMEOUT_MS = 30_000
const SHORT_SIZES = [
  { width: 390, height: 664 },
  { width: 375, height: 667 },
  { width: 375, height: 548 },
]
const TALL_SIZE = { width: 390, height: 844 }

const sheet = (page: Page) => page.getByRole('dialog', { name: '送出搭車請求' })

async function openPhone(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size)
  await page.goto(PASSENGER)
  await page.getByRole('button', { name: '今天我要搭' }).click({ timeout: STEP_TIMEOUT_MS })
  await expect(sheet(page)).toBeVisible()
}

/** Whole inside the window, without scrolling anything first. */
async function expectOnScreen(locator: Locator, viewportHeight: number) {
  const b = (await locator.boundingBox())!
  expect(b.y).toBeGreaterThanOrEqual(0)
  expect(b.y + b.height).toBeLessThanOrEqual(viewportHeight)
}

/** The page itself never scrolls; the screens scroll inside (T77). */
async function expectPageDoesNotScroll(page: Page) {
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight > window.innerHeight)).toBe(false)
}

/** Scrolled into view, it shows whole inside its scroll area, not cut off under the button. */
async function expectReachable(item: Locator, area: Locator) {
  await item.scrollIntoViewIfNeeded()
  const i = (await item.boundingBox())!
  const a = (await area.boundingBox())!
  expect(i.y).toBeGreaterThanOrEqual(a.y - 1)
  expect(i.y + i.height).toBeLessThanOrEqual(a.y + a.height + 1)
}

for (const size of [TALL_SIZE, SHORT_SIZES[0], SHORT_SIZES[2]]) {
  test(`${size.width}×${size.height} 送出搭車請求: both buttons without scrolling; the options scroll and still send (REQ-035, DD-25)`, async ({ page }) => {
    await openPhone(page, size)
    const send = sheet(page).getByRole('button', { name: '送出請求' })
    const later = sheet(page).getByRole('button', { name: '先不要' })
    await expectOnScreen(send, size.height)
    await expectOnScreen(later, size.height)
    await expectPageDoesNotScroll(page)

    // The last filter is the furthest down: it scrolls into view and the buttons do not move.
    // 最好 (preferred), so a car still matches; 一定要 could leave none (REQ-035).
    const before = await send.boundingBox()
    const last = sheet(page).getByRole('radiogroup').last().getByRole('radio', { name: '最好' })
    await expectReachable(last, page.getByTestId('submit-options'))
    await last.click()
    await expect(last).toHaveAttribute('aria-checked', 'true')
    expect(await send.boundingBox()).toEqual(before)

    await send.click()
    await expect(page.getByRole('heading', { name: '正在等駕駛確認' })).toBeVisible()
  })
}

for (const size of [...SHORT_SIZES, TALL_SIZE]) {
  test(`${size.width}×${size.height} 共乘完成: 回到首頁 on screen and back to the board; the ride scrolls into view (REQ-055, DD-23)`, async ({ page }) => {
    test.setTimeout(90_000)
    await openPhone(page, size)
    await sheet(page).getByRole('button', { name: '送出請求' }).click()
    await page.getByRole('button', { name: '我已上車' }).click({ timeout: STEP_TIMEOUT_MS })
    await page.getByRole('button', { name: '我已下車，結束共乘' }).click({ timeout: STEP_TIMEOUT_MS })
    await expect(page.getByRole('heading', { name: '共乘完成' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })

    const home = page.locator('#root').getByRole('button', { name: '回到首頁' })
    await expectOnScreen(home, size.height)
    await expectPageDoesNotScroll(page)
    const content = page.getByTestId('completed-content')
    const ride = page.getByRole('list', { name: '這趟共乘' })
    await expectReachable(ride.getByText('上車', { exact: true }), content)
    await expectReachable(ride.getByText('下車', { exact: true }), content)
    await expectReachable(page.getByText(/^ABC-\d{4}$/), content)
    // Scrolling the ride leaves the button where it was.
    await expectOnScreen(home, size.height)

    await home.click()
    await expect(page.getByRole('button', { name: '今天我要搭' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  })
}
