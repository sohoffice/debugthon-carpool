import { expect, type Page } from '@playwright/test'

/** T76 sizes: iPhone 13 under Safari's bars, iPhone SE, iPhone SE under Safari's bars, iPhone 13. */
export const SHORT_SIZES = [
  { width: 390, height: 664 },
  { width: 375, height: 667 },
  { width: 375, height: 548 },
]
export const TALL_SIZE = { width: 390, height: 844 }
/** Below this the map is not drawn at all (UD-29, T76). */
export const MIN_MAP_HEIGHT = 140
/** Driver in-trip buttons (docs/ui-design.md 9). */
export const MIN_BUTTON_HEIGHT = 64

export interface RequestScreenLayout {
  /** Height of the drawn map, 0 when there is none. */
  map: number
  /** Whether the map block has anything in it. */
  mapDrawn: boolean
  confirm: { top: number; bottom: number; height: number }
  decline: { top: number; bottom: number; height: number }
  /** The stop names' font size, in px. */
  nameSize: number
}

/** Reads SC-D3 as laid out: the map and the two buttons. */
export async function requestScreenLayout(page: Page): Promise<RequestScreenLayout> {
  await expect(page.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible()
  const box = async (name: string) => {
    const b = (await page.getByRole('button', { name, exact: true }).boundingBox())!
    return { top: b.y, bottom: b.y + b.height, height: b.height }
  }
  const map = page.getByTestId('request-map')
  const mapBox = await map.boundingBox()
  const mapDrawn = mapBox !== null && (await map.evaluate((el) => el.childElementCount > 0))
  const nameSize = await page.getByRole('definition').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  return { map: mapDrawn ? mapBox!.height : 0, mapDrawn, confirm: await box('確認'), decline: await box('婉拒'), nameSize }
}

/** Both buttons whole inside the window, at least 64px tall, and the page does not scroll (UD-05). */
export async function expectButtonsOnScreen(page: Page, layout: RequestScreenLayout, viewportHeight: number) {
  for (const b of [layout.confirm, layout.decline]) {
    expect(b.top).toBeGreaterThanOrEqual(0)
    expect(b.bottom).toBeLessThanOrEqual(viewportHeight)
    expect(b.height).toBeGreaterThanOrEqual(MIN_BUTTON_HEIGHT)
  }
  const scrolls = await page.evaluate(() => document.scrollingElement!.scrollHeight > window.innerHeight)
  expect(scrolls).toBe(false)
}

/** A map is either drawn at a readable height or not there at all, never squashed (UD-29, T76). */
export function expectMapReadableOrAbsent(layout: RequestScreenLayout) {
  if (layout.mapDrawn) expect(layout.map).toBeGreaterThanOrEqual(MIN_MAP_HEIGHT)
}
