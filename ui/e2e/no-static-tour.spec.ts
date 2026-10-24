import { expect, test } from '@playwright/test'
import { E2E_PORTS } from '../playwright.config'

// T70 (#210): the passenger tour is the static site's only. The app on its own port has no coach bar
// and sends nothing for the tour's cars (DD-46).
const PASSENGER_URL = `http://localhost:${E2E_PORTS.passenger}/?account=passenger1`

test('passenger app on its own port: no coach bar, no tour cars reporting', async ({ page }) => {
  const driverCalls: string[] = []
  page.on('request', (r) => {
    if (r.headers().authorization?.startsWith('Bearer driver:')) driverCalls.push(r.url())
  })
  await page.goto(PASSENGER_URL)
  await expect(page.getByRole('button', { name: '今天我要搭' })).toBeVisible({ timeout: 30_000 })
  // The tour starts its cars on load and polls every 500 ms: three seconds is plenty to see it.
  await page.waitForTimeout(3000)
  await expect(page.locator('#static-coach')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '導覽' })).toHaveCount(0)
  expect(driverCalls).toEqual([])
})
