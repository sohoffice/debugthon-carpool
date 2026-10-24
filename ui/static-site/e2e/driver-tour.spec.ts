import { expect, test, type Page } from '@playwright/test'
import { SITE_URL } from '../playwright.config'

// T69, DD-46: the driver tour on the built static site, at the iPhone 13 size (390 px).
const DRIVER = `${SITE_URL}driver/index.html`
const PORTAL = `${SITE_URL}index.html`
const STEP_TIMEOUT_MS = 30_000

const bar = (page: Page) => page.getByRole('navigation', { name: '導覽' })

async function onStep(page: Page, step: number, text: string) {
  await expect(bar(page)).toHaveAttribute('data-step', String(step), { timeout: STEP_TIMEOUT_MS })
  await expect(bar(page)).toContainText(text)
  // 首頁 on every step (T69 acceptance).
  await expect(bar(page).getByRole('link', { name: '首頁', exact: true })).toHaveAttribute('href', '../index.html')
}

test('three taps, about a minute: 我出發了, 確認, 已上車 → 行程結束, 這趟載了 1 位乘客 (REQ-065)', async ({ page }) => {
  test.setTimeout(90_000)
  const started = Date.now()
  await page.goto(DRIVER)
  await onStep(page, 1, '按「我出發了」')
  await page.getByRole('button', { name: '我出發了' }).click()

  await expect(page.getByRole('heading', { name: /目前沒有/ })).toBeVisible()
  await onStep(page, 2, '幾秒後會有人要搭')

  await expect(page.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await onStep(page, 3, '按「確認」')
  await page.getByRole('button', { name: '確認', exact: true }).click()

  const boarded = page.getByRole('button', { name: /已上車/ })
  await expect(boarded).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await onStep(page, 4, '按「已上車」')
  await boarded.click()

  await expect(page.getByText('這趟載了 1 位乘客')).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await expect(page.getByText('行程結束')).toBeVisible()
  await onStep(page, 5, '完成')
  // The ended screen itself stays as it is (SC-D4).
  await expect(page.getByRole('button', { name: '好' })).toBeVisible()
  await expect(bar(page).getByRole('link', { name: '換成乘客體驗' })).toHaveAttribute('href', '../passenger/index.html')
  await expect(bar(page).getByRole('link', { name: '回到首頁' })).toHaveAttribute('href', '../index.html')
  expect(Date.now() - started).toBeLessThan(60_000)
})

test('婉拒: the next request comes a few seconds later', async ({ page }) => {
  await page.goto(DRIVER)
  await page.getByRole('button', { name: '我出發了' }).click()
  await expect(page.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await page.getByRole('button', { name: '婉拒' }).click()
  await expect(page.getByRole('heading', { name: /目前沒有/ })).toBeVisible()
  await onStep(page, 2, '幾秒後會有人要搭')
  const declinedAt = Date.now()
  await expect(page.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible({ timeout: 10_000 })
  expect(Date.now() - declinedAt).toBeLessThan(10_000)
  await onStep(page, 3, '按「確認」')
})

test('首頁 from the middle of a trip goes to the portal; the driver again starts at step 1', async ({ page }) => {
  await page.goto(DRIVER)
  await page.getByRole('button', { name: '我出發了' }).click()
  await expect(page.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await bar(page).getByRole('link', { name: '首頁', exact: true }).click()
  await expect(page).toHaveURL(PORTAL)
  await page.getByRole('link', { name: /^我是駕駛/ }).click()
  await expect(page.getByRole('button', { name: '我出發了' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await onStep(page, 1, '按「我出發了」')
})

test('the coach bar does not cover the app: the 我出發了 button is fully on screen', async ({ page }) => {
  await page.goto(DRIVER)
  const button = page.getByRole('button', { name: '我出發了' })
  await expect(button).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  const box = (await button.boundingBox())!
  const barBox = (await bar(page).boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(barBox.y + barBox.height)
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(page.viewportSize()!.height)
})

test('showcase.html: no coach bar and no tour request in its phones', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, isMobile: false })).newPage()
  await page.goto(`${SITE_URL}showcase.html`)
  const driver = page.frameLocator('iframe[title="駕駛 App"]')
  await expect(driver.getByRole('button', { name: '我出發了' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await expect(driver.getByRole('navigation', { name: '導覽' })).toHaveCount(0)
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible()
  // Well past the tour's 4 s: nobody asks, as the showcase's simulator has not started either.
  await page.waitForTimeout(8000)
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toHaveCount(0)
})
