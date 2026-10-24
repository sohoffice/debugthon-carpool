import { expect, test, type Browser, type Page } from '@playwright/test'
import { SITE_URL } from '../playwright.config'

// T68, DD-46: the static site's portal, run on the built site under the bucket's sub-path.
const PORTAL = `${SITE_URL}index.html`
const ROLES = [
  { card: '我是駕駛', path: 'driver/index.html', ready: { role: 'heading', name: '今天載人嗎？' } },
  { card: '我是乘客', path: 'passenger/index.html', ready: { role: 'button', name: '今天我要搭' } },
] as const
const HOME = '← 首頁'
const STEP_TIMEOUT_MS = 30_000

async function openAt(browser: Browser, width: number, height: number, url: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 })
  const page = await context.newPage()
  await page.goto(url)
  return page
}

function card(page: Page, name: string) {
  return page.getByRole('navigation', { name: '選一個身分' }).getByRole('link', { name: new RegExp(`^${name}`) })
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth))
}

test('390px: the three cards stack, full size, no sideways scroll', async ({ browser }) => {
  const page = await openAt(browser, 390, 844, PORTAL)
  const boxes = await Promise.all(['我是駕駛', '我是乘客', '市府儀表板'].map(async (n) => (await card(page, n).boundingBox())!))
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].x).toBe(boxes[0].x)
    expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height)
  }
  // Not scaled: a card fills the width less the 16px side margins.
  expect(boxes[0].width).toBe(390 - 2 * 16)
  await noSideScroll(page)
})

test('1440px: the three cards sit in one row', async ({ browser }) => {
  const page = await openAt(browser, 1440, 900, PORTAL)
  const boxes = await Promise.all(['我是駕駛', '我是乘客', '市府儀表板'].map(async (n) => (await card(page, n).boundingBox())!))
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].y).toBe(boxes[0].y)
    expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width)
  }
  await noSideScroll(page)
})

test('the portal says all data is simulated (REQ-063)', async ({ page }) => {
  await page.goto(PORTAL)
  await expect(page.getByText('所有資料都是模擬的')).toBeVisible()
})

test('the portal does not link to the showcase', async ({ page }) => {
  await page.goto(PORTAL)
  await expect(page.locator('a[href*="showcase"]')).toHaveCount(0)
})

for (const role of ROLES) {
  test(`${role.card}: the full-screen phone app, not a framed one; back returns to the portal`, async ({ page }) => {
    await page.goto(PORTAL)
    await card(page, role.card).click()
    await expect(page).toHaveURL(`${SITE_URL}${role.path}`)
    await expect(page.getByRole(role.ready.role, { name: role.ready.name })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
    await expect(page.getByTestId('phone-frame')).toHaveCount(0)
    await page.goBack()
    await expect(page).toHaveURL(PORTAL)
    await expect(card(page, role.card)).toBeVisible()
  })
}

test('市府儀表板: has 「← 首頁」 top left, which returns to the portal; back works too', async ({ browser }) => {
  const page = await openAt(browser, 1440, 900, PORTAL)
  await card(page, '市府儀表板').click()
  await expect(page).toHaveURL(`${SITE_URL}city/index.html`)
  const home = page.getByRole('link', { name: HOME })
  await expect(home).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  expect(await home.boundingBox()).toMatchObject({ x: 0, y: 0 })
  // Clear of the header's name.
  const name = (await page.getByRole('heading', { level: 1 }).boundingBox())!
  const box = (await home.boundingBox())!
  expect(name.x).toBeGreaterThanOrEqual(box.x + box.width)

  await page.goBack()
  await expect(page).toHaveURL(PORTAL)
  await page.goForward()
  await home.click()
  await expect(page).toHaveURL(PORTAL)
})

test('390px 市府儀表板: 「← 首頁」 is clear of the name too', async ({ browser }) => {
  const page = await openAt(browser, 390, 844, `${SITE_URL}city/index.html`)
  const home = page.getByRole('link', { name: HOME })
  await expect(home).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  const box = (await home.boundingBox())!
  expect(box).toMatchObject({ x: 0, y: 0 })
  const brandBar = (await page.getByRole('heading', { level: 1 }).locator('span').first().boundingBox())!
  expect(brandBar.x).toBeGreaterThanOrEqual(box.x + box.width)
})

test('picking the driver again after going home starts over', async ({ page }) => {
  await page.goto(PORTAL)
  await card(page, '我是駕駛').click()
  await page.getByRole('button', { name: '我出發了' }).click({ timeout: STEP_TIMEOUT_MS })
  await expect(page.getByRole('heading', { name: /目前沒有/ })).toBeVisible({ timeout: STEP_TIMEOUT_MS })

  // Home, the way T69's bar will: a link to the portal, so the page and its mock backend load afresh.
  await page.goto(PORTAL)
  await card(page, '我是駕駛').click()
  await expect(page.getByRole('heading', { name: '今天載人嗎？' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
})

test('picking the passenger again after going home starts over', async ({ page }) => {
  await page.goto(PORTAL)
  await card(page, '我是乘客').click()
  await page.getByRole('button', { name: '今天我要搭' }).click({ timeout: STEP_TIMEOUT_MS })
  await page.getByRole('button', { name: '送出請求' }).click()
  await expect(page.getByRole('heading', { name: /正在等駕駛確認|駕駛無法載你|目前沒有可搭的車/ })).toBeVisible({ timeout: STEP_TIMEOUT_MS })

  await page.goto(PORTAL)
  await card(page, '我是乘客').click()
  await expect(page.getByRole('button', { name: '今天我要搭' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
})

test('direct showcase.html is still the two-phone showcase, and 開始 Demo runs the Demo (DD-45)', async ({ browser }) => {
  test.setTimeout(180_000)
  const page = await openAt(browser, 1920, 1080, `${SITE_URL}showcase.html`)
  const driver = page.frameLocator('iframe[title="駕駛 App"]')
  const passenger = page.frameLocator('iframe[title="乘客 App"]')
  await page.getByRole('button', { name: '開始 Demo' }).click()
  await expect(page.getByRole('button', { name: '重新開始' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  // 開始 Demo reloads both phones; wait for the simulator to report in before tapping (as ui/scripts/demo-record.ts does).
  await page.getByRole('button', { name: /^紀錄/ }).click()
  await expect(page.getByRole('list', { name: '紀錄' }).getByText('模擬器開始了')).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await page.getByRole('button', { name: '收起紀錄' }).click()
  await expect(driver.getByRole('heading', { name: '今天載人嗎？' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })

  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await passenger.getByRole('button', { name: '今天我要搭' }).click({ timeout: STEP_TIMEOUT_MS })
  await passenger.getByRole('button', { name: '送出請求' }).click()
  await expect(passenger.getByRole('heading', { name: '正在等駕駛確認' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  // The in-browser mock ranks the car on stage first (mock-server/src/matching.ts), so driver5's
  // off-stage decline does not show here; it does on the Go backend.
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await driver.getByRole('button', { name: '確認', exact: true }).click()
  await expect(passenger.getByRole('button', { name: '我已上車' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await expect(passenger.getByRole('heading', { name: '車已到上車點' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await passenger.getByRole('button', { name: '我已上車' }).click()
  await expect(passenger.getByRole('heading', { name: '共乘完成' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await expect(driver.getByText('這趟載了 1 位乘客')).toBeVisible({ timeout: STEP_TIMEOUT_MS })
})
