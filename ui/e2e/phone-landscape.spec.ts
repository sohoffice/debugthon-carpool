import { expect, test, type Browser, type BrowserContextOptions } from '@playwright/test'
import { E2E_PORTS } from '../playwright.config'

const API = `http://localhost:${E2E_PORTS.mock}/api`
const APPS = [
  { role: '駕駛', url: `http://localhost:${E2E_PORTS.driver}/?account=driver4`, button: '我出發了' },
  { role: '乘客', url: `http://localhost:${E2E_PORTS.passenger}/?account=passenger1`, button: '今天我要搭' },
]
/** Phones turned on their side (T83 acceptance sizes). */
const LANDSCAPE = [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
]
/** Desktop windows that keep the phone frame (T83 acceptance sizes). */
const DESKTOP = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]
/** Smallest comfortable touch target (T83 acceptance). */
const MIN_TOUCH = 44

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${API}/_mock/scenario`, { data: { scenario: 'normal' } })).ok()).toBe(true)
})

async function open(browser: Browser, url: string, options: BrowserContextOptions) {
  const context = await browser.newContext({ deviceScaleFactor: 1, ...options })
  const page = await context.newPage()
  await page.goto(url)
  return page
}

for (const app of APPS) {
  for (const size of LANDSCAPE) {
    test(`${app.role} on a phone on its side ${size.width}×${size.height}: full screen, ${app.button} easy to press (UD-13, T83)`, async ({ browser }) => {
      const page = await open(browser, app.url, { viewport: size, isMobile: true, hasTouch: true })
      const button = page.getByRole('button', { name: app.button })
      await expect(button).toBeVisible()
      await expect(page.getByTestId('phone-frame')).toHaveCount(0)

      const b = (await button.boundingBox())!
      expect(b.height).toBeGreaterThanOrEqual(MIN_TOUCH)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(size.width)
      expect(b.y + b.height).toBeLessThanOrEqual(size.height)
      await page.context().close()
    })
  }

  for (const size of DESKTOP) {
    test(`${app.role} in a desktop browser ${size.width}×${size.height}: keeps the phone frame (UD-13, T83)`, async ({ browser }) => {
      const page = await open(browser, app.url, { viewport: size, isMobile: false, hasTouch: false })
      await expect(page.getByRole('button', { name: app.button })).toBeVisible()
      await expect(page.getByTestId('phone-frame')).toBeVisible()
      await expect(page.getByTestId('role-label')).toHaveText(app.role)
      await page.context().close()
    })
  }

  test(`${app.role} embedded by the showcase page on a phone on its side: still no frame of its own (UD-13, T83)`, async ({ browser }) => {
    const page = await open(browser, `${app.url}&embed=1`, { viewport: LANDSCAPE[0], isMobile: true, hasTouch: true })
    await expect(page.getByRole('button', { name: app.button })).toBeVisible()
    await expect(page.getByTestId('phone-frame')).toHaveCount(0)
    // Embedded, the app draws the simulated status bar; full screen on a phone it does not (UD-13).
    await expect(page.getByText('08:12')).toBeVisible()
    await page.context().close()
  })
}
