import { expect, test, type Browser } from '@playwright/test'
import { E2E_PORTS } from '../playwright.config'

const FULL_NAME = '內科上班順起來: 內科順路共乘'
const APPS = [
  { role: '乘客', url: `http://localhost:${E2E_PORTS.passenger}/?account=passenger1` },
  { role: '駕駛', url: `http://localhost:${E2E_PORTS.driver}/?account=driver4` },
]
/** T58 acceptance sizes; 600×700 is the tightest one with the phone frame on (UD-13). */
const SIZES = [
  { width: 600, height: 700 },
  { width: 600, height: 900 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]

/** A desktop browser window, not the iPhone the other specs use, so the app draws its phone frame. */
async function openDesktop(browser: Browser, url: string, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, isMobile: false, hasTouch: false, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.goto(url)
  return page
}

for (const app of APPS) {
  for (const size of SIZES) {
    test(`${app.role} ${size.width}×${size.height}: the name stays clear of the phone frame (UD-13, T58)`, async ({ browser }) => {
      const page = await openDesktop(browser, app.url, size)
      const name = page.getByText(FULL_NAME, { exact: true })
      const frame = page.getByTestId('phone-frame')
      const caption = page.getByTestId('role-label')
      await expect(name).toBeVisible()
      await expect(caption).toHaveText(app.role)

      const n = (await name.boundingBox())!
      const f = (await frame.boundingBox())!
      const c = (await caption.boundingBox())!
      // Clear of the frame: the name ends above the frame's top edge.
      expect(n.y + n.height).toBeLessThanOrEqual(f.y)
      // One line: the name is no taller than a single line of its text.
      const lineHeight = await name.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
      expect(n.height).toBeLessThanOrEqual(lineHeight + 1)
      // Frame and role label inside the window, with no scrollbars.
      expect(f.x).toBeGreaterThanOrEqual(0)
      expect(f.x + f.width).toBeLessThanOrEqual(size.width)
      expect(c.y + c.height).toBeLessThanOrEqual(size.height)
      const scroll = await page.evaluate(() => {
        const el = document.scrollingElement!
        return { x: el.scrollWidth > window.innerWidth, y: el.scrollHeight > window.innerHeight }
      })
      expect(scroll).toEqual({ x: false, y: false })
      await page.context().close()
    })
  }
}

test('乘客 below 600px wide: full screen, no phone frame (UD-13)', async ({ browser }) => {
  const page = await openDesktop(browser, APPS[0].url, { width: 599, height: 900 })
  await expect(page.getByRole('heading', { name: /最快 \d+ 分鐘到|10 分鐘內沒有車/ })).toBeVisible()
  await expect(page.getByTestId('phone-frame')).toHaveCount(0)
  await expect(page.getByText(FULL_NAME, { exact: true })).toHaveCount(0)
  await page.context().close()
})
