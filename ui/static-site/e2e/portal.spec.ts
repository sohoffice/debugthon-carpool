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
/**
 * The pause ui/scripts/demo-auto.ts takes after each step (its SETTLE_MS). The simulator puts driver4
 * and driver5 at their path starts on its next round (DD-14); tapping sooner can give driver4 the request.
 */
const DEMO_SETTLE_MS = 1000

async function openAt(browser: Browser, width: number, height: number, url: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 })
  const page = await context.newPage()
  await page.goto(url)
  return page
}

function card(page: Page, name: string) {
  return page.getByRole('navigation', { name: '選一個身分' }).getByRole('link', { name: new RegExp(`^${name}`) })
}

/** Waits for a line in the showcase's log (UD-30), the same check as ui/scripts/demo-auto.ts. */
async function logged(page: Page, pattern: RegExp) {
  await page.getByRole('button', { name: /^紀錄/ }).click()
  await expect(page.getByRole('list', { name: '紀錄' }).getByText(pattern).first()).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await page.getByRole('button', { name: '收起紀錄' }).click()
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

// 768 and 1023: single column up to 1024px since T72 (#219), the link moved with it.
for (const width of [360, 390, 768, 1023]) {
  test(`${width}px 市府儀表板: 「← 首頁」 is clear of the name, and the name of the clock`, async ({ browser }) => {
    const page = await openAt(browser, width, 844, `${SITE_URL}city/index.html`)
    const home = page.getByRole('link', { name: HOME })
    await expect(home).toBeVisible({ timeout: STEP_TIMEOUT_MS })
    const box = (await home.boundingBox())!
    expect(box).toMatchObject({ x: 0, y: 0 })
    const name = page.getByRole('heading', { level: 1 })
    const brandBar = (await name.locator('span').first().boundingBox())!
    expect(brandBar.x).toBeGreaterThanOrEqual(box.x + box.width)

    // Guards the narrow-header contract with T71 (#208): the padding this site adds must not push the
    // name into the clock on the same row. On a desktop-only header (no T71 yet) it passes trivially.
    const clock = page.locator('#root header').getByText(/^\d{1,2}\/\d{1,2} 週/)
    await expect(clock).toBeVisible({ timeout: STEP_TIMEOUT_MS })
    const nameTextRight = await name.evaluate((h1) => {
      const range = document.createRange()
      range.selectNodeContents(h1)
      return Math.max(...[...range.getClientRects()].map((r) => r.right))
    })
    const clockBox = (await clock.boundingBox())!
    const sameRow = clockBox.y < brandBar.y + brandBar.height && clockBox.y + clockBox.height > brandBar.y
    if (sameRow) expect(nameTextRight).toBeLessThanOrEqual(clockBox.x)

    // The narrow link stays in the name's row, clear of the tabs below it, which keep their full width.
    const firstTab = (await page.getByRole('tab').first().boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(firstTab.y)
    expect(firstTab.x).toBeLessThan(box.width)
  })
}

// T72 (#219): from 1024px the link is 72×60 and pads the whole top bar; the clock and 模擬時間 still fit.
for (const width of [1024, 1280, 1440]) {
  test(`${width}px 市府儀表板: with 「← 首頁」 the top bar fits, the clock and 模擬時間 inside the window`, async ({ browser }) => {
    const page = await openAt(browser, width, 800, `${SITE_URL}city/index.html`)
    await expect(page.getByRole('link', { name: HOME })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
    await expect(page.getByTestId('network-lights')).toContainText(/\d+ 處/, { timeout: STEP_TIMEOUT_MS })
    const header = page.locator('#root header')
    expect(await header.evaluate((h) => h.scrollWidth - h.clientWidth)).toBe(0)
    for (const text of ['模擬時間', /^\d{2}:\d{2}$/]) {
      const box = (await header.getByText(text).boundingBox())!
      expect(box.x + box.width, String(text)).toBeLessThanOrEqual(width)
    }
  })
}

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
  // 開始 Demo reloads both phones; wait for the simulator to report in before tapping (as ui/scripts/demo-auto.ts does).
  await logged(page, /模擬器開始了/)
  await expect(driver.getByRole('heading', { name: '今天載人嗎？' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })

  await page.waitForTimeout(DEMO_SETTLE_MS)
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  // driver5 follows off stage (DD-45 step 2); the request must wait for it, or only driver4 can be matched.
  await logged(page, /driver5 (跟著出發了|已經在行程中)/)
  await page.waitForTimeout(DEMO_SETTLE_MS)
  await passenger.getByRole('button', { name: '今天我要搭' }).click({ timeout: STEP_TIMEOUT_MS })
  // The Demo's two stage tags 一定要, as ui/scripts/demo-auto.ts sends: only driver4 and driver5 carry both (DD-45 step 1).
  const sheet = passenger.getByRole('dialog', { name: '送出搭車請求' })
  for (const name of ['不抽菸', '安靜坐車']) await sheet.getByRole('radiogroup', { name: `${name}的篩選` }).getByRole('radio', { name: '一定要' }).click()
  await passenger.getByRole('button', { name: '送出請求' }).click()
  await expect(passenger.getByRole('heading', { name: '正在等駕駛確認' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  // driver5 gets it first and declines, so it goes on to driver4 (DD-45 step 3, REQ-050).
  await logged(page, /driver5 婉拒了/)
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await driver.getByRole('button', { name: '確認', exact: true }).click()
  await expect(passenger.getByRole('button', { name: '我已上車' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await expect(passenger.getByRole('heading', { name: '車已到上車點' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await passenger.getByRole('button', { name: '我已上車' }).click()
  await expect(passenger.getByRole('heading', { name: '共乘完成' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
  await expect(driver.getByText('這趟載了 1 位乘客')).toBeVisible({ timeout: STEP_TIMEOUT_MS })
})
