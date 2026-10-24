import { expect, test, type Browser, type Page } from '@playwright/test'
import { SITE_URL } from '../playwright.config'

// T70 (#210), DD-46: the static site's passenger tour, on the built site at phone width.
const PASSENGER = `${SITE_URL}passenger/index.html`
const PORTAL = `${SITE_URL}index.html`
const STEP_TIMEOUT_MS = 30_000
/** #210: 送出後約 3 秒內畫面換成已確認; a little room for the test's own polling. */
const CONFIRM_WITHIN_MS = 3500

async function openPhone(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.goto(url)
  return page
}

const bar = (page: Page) => page.getByRole('navigation', { name: '導覽' })

/** The bar is on step `n` (1-based) of 6, and says `text`. */
async function onStep(page: Page, n: number, text: string | RegExp) {
  await expect(bar(page)).toHaveAttribute('data-step', String(n), { timeout: STEP_TIMEOUT_MS })
  await expect(bar(page)).toContainText(`第 ${n} 步，共 6 步`)
  await expect(bar(page)).toContainText(text)
  await expect(bar(page).getByRole('link', { name: '首頁', exact: true })).toBeVisible()
}

test('390px: four taps, six steps in step with the screens, done within a minute (T70)', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await openPhone(browser, PASSENGER)
  const started = Date.now()

  // 1 供給看板: destination preset (no SC-P1), at least 3 cars on the board (REQ-061, simulated: REQ-063).
  const go = page.getByRole('button', { name: '今天我要搭' })
  await expect(go).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await onStep(page, 1, '「今天我要搭」')
  await expect(page.getByText(/^[3-9] 台車接近中$/)).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await expect(page.getByText('由平台替你分配車，不能自選')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)

  // 2 送出前確認 (SC-P3).
  await go.click()
  await expect(page.getByRole('dialog', { name: '送出搭車請求' })).toBeVisible()
  await onStep(page, 2, '「送出請求」')

  // 3 等駕駛確認, then the matched car confirms by itself (DD-33): 4 已確認 with the simulated push.
  await page.getByRole('button', { name: '送出請求' }).click()
  const sent = Date.now()
  await expect(page.getByRole('heading', { name: '正在等駕駛確認' })).toBeVisible()
  await onStep(page, 3, '正在幫你找順路的駕駛')
  await expect(page.getByRole('button', { name: '我已上車' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  expect(Date.now() - sent).toBeLessThanOrEqual(CONFIRM_WITHIN_MS)
  await expect(page.getByRole('status').getByText('配到車了')).toBeVisible()
  await onStep(page, 4, '「我已上車」')

  // The car fast-forwards to the pickup (T63); 5 已上車, then to short of the drop-off (T64).
  await expect(page.getByRole('heading', { name: '車已到上車點' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await page.getByRole('button', { name: '我已上車' }).click()
  const done = page.getByRole('button', { name: '我已下車，結束共乘' })
  await expect(done).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await onStep(page, 5, '「我已下車，結束共乘」')
  // After the fast-forward the ride is still the visitor's to end (DD-23): no 共乘完成 by itself.
  await page.waitForTimeout(8000)
  await expect(done).toBeVisible()

  // 6 共乘完成, with the other role and 回到首頁 on the bar.
  await done.click()
  await expect(page.getByRole('heading', { name: '共乘完成' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await onStep(page, 6, '今天少開一輛車進內科')
  await expect(bar(page).getByRole('link', { name: '換成駕駛體驗' })).toHaveAttribute('href', '../driver/index.html')
  await expect(bar(page).getByRole('link', { name: '回到首頁' })).toHaveAttribute('href', '../index.html')
  expect(Date.now() - started).toBeLessThan(60_000)

  // The completed screen's own 回到首頁 is the app's board again: the bar follows, back to step 1.
  await page.locator('#root').getByRole('button', { name: '回到首頁' }).click()
  await expect(page.getByRole('button', { name: '今天我要搭' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await onStep(page, 1, '「今天我要搭」')
})

test('首頁 on the bar goes back to the portal; picking the passenger again starts at step 1 (T70)', async ({ browser }) => {
  const page = await openPhone(browser, PASSENGER)
  await page.getByRole('button', { name: '今天我要搭' }).click({ timeout: STEP_TIMEOUT_MS })
  await page.getByRole('button', { name: '送出請求' }).click()
  await onStep(page, 3, '正在幫你找順路的駕駛')

  await bar(page).getByRole('link', { name: '首頁', exact: true }).click()
  await expect(page).toHaveURL(PORTAL)
  await page.getByRole('navigation', { name: '選一個身分' }).getByRole('link', { name: /^我是乘客/ }).click()
  await expect(page.getByRole('button', { name: '今天我要搭' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await onStep(page, 1, '「今天我要搭」')
})

test('the passenger app inside showcase.html has no coach bar (T70)', async ({ browser }) => {
  const page = await openPhone(browser, `${SITE_URL}showcase.html`)
  const passenger = page.frameLocator('iframe[title="乘客 App"]')
  await expect(passenger.locator('#root')).toBeAttached({ timeout: STEP_TIMEOUT_MS })
  await page.waitForTimeout(2000)
  await expect(passenger.locator('#static-coach')).toHaveCount(0)
})
