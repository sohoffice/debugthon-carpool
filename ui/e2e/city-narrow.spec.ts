import { expect, test, type Browser, type Page } from '@playwright/test'
import { E2E_PORTS } from '../playwright.config'

// T71 and T72 acceptance: the city war room at phone, tablet (single column below 1024px) and desktop sizes.
const URL = `http://localhost:${E2E_PORTS.city}/?account=city1`
const TABS = ['總覽', '即時地圖', '車流熱力']
const MIN_TEXT_PX = 12

async function open(browser: Browser, width: number, height: number) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 1024, hasTouch: width < 1024, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.goto(URL)
  await expect(page.getByTestId('kpi-value').first()).not.toHaveText('—')
  return page
}

/** The page's sideways overflow, and the smallest text on screen: its size and where it is. */
function measure(page: Page) {
  return page.evaluate(() => {
    let smallest = { px: Infinity, text: '' }
    for (const el of document.querySelectorAll<HTMLElement | SVGElement>('body *')) {
      const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
      if (!own || el.getBoundingClientRect().width === 0) continue
      // SVG text is scaled with its viewBox: its drawn height is the size that counts.
      const px = el instanceof SVGTextElement ? el.getBoundingClientRect().height : parseFloat(getComputedStyle(el).fontSize)
      if (px < smallest.px) smallest = { px, text: el.textContent!.trim().slice(0, 30) }
    }
    const root = document.documentElement
    return { overflowX: root.scrollWidth - root.clientWidth, overflowY: root.scrollHeight - root.clientHeight, smallest }
  })
}

test.describe('390px (T71)', () => {
  test('three tabs: no sideways page scroll, no text under 12px', async ({ browser }) => {
    const page = await open(browser, 390, 844)
    for (const name of TABS) {
      await page.getByRole('tab', { name }).click()
      const m = await measure(page)
      expect(m.overflowX, name).toBe(0)
      expect(m.smallest.px, `${name}: ${m.smallest.text}`).toBeGreaterThanOrEqual(MIN_TEXT_PX)
    }
  })

  test('only the grid and the time keys scroll sideways, inside their own area', async ({ browser }) => {
    const page = await open(browser, 390, 844)
    const grid = page.getByRole('grid', { name: '今天各入口每 15 分鐘的路況' })
    const scrolls = (l: ReturnType<Page['getByRole']>) => l.evaluate((e) => e.scrollWidth > e.clientWidth && getComputedStyle(e).overflowX === 'auto')
    expect(await scrolls(grid)).toBe(true)
    // The gateway names stay put while the slots scroll.
    const name = grid.getByRole('rowheader').first()
    const before = (await name.boundingBox())!.x
    await grid.evaluate((e) => (e.scrollLeft = 200))
    expect((await name.boundingBox())!.x).toBe(before)

    await page.getByRole('tab', { name: '車流熱力' }).click()
    const keys = page.getByRole('group', { name: '時段' })
    expect(await scrolls(keys)).toBe(true)
    // The selected slot is scrolled into view.
    const pressed = (await keys.getByRole('button', { pressed: true }).boundingBox())!
    const row = (await keys.boundingBox())!
    expect(pressed.x).toBeGreaterThanOrEqual(row.x)
    expect(pressed.x + pressed.width).toBeLessThanOrEqual(row.x + row.width)
  })

  test('總覽: number row, grid, requests, history and pickup points are all there, down the page', async ({ browser }) => {
    const page = await open(browser, 390, 844)
    expect((await measure(page)).overflowY).toBeGreaterThan(0)
    const areas = ['估計減少的車次', '路上的共乘車', '等待配對', '成功配對', '無車可配', '入口 × 15 分鐘', '今天的請求', '過去 10 個上班日的共乘數', '各上車點']
    let bottom = 0
    for (const name of areas) {
      const area = page.getByRole('region', { name, exact: true })
      await area.scrollIntoViewIfNeeded()
      await expect(area).toBeInViewport()
      const box = (await area.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY } }))
      if (['路上的共乘車', '等待配對', '成功配對', '無車可配'].includes(name)) continue
      // One column: each area starts below the one before.
      expect(box.top, name).toBeGreaterThanOrEqual(bottom)
      bottom = box.bottom
    }
    // 估計減少的車次 full width, the other four 2 × 2.
    const w = async (name: string) => (await page.getByRole('region', { name, exact: true }).boundingBox())!
    const [saved, cars, waiting, rate] = await Promise.all(['估計減少的車次', '路上的共乘車', '等待配對', '成功配對'].map(w))
    expect(cars.width).toBeLessThan(saved.width / 2)
    expect(waiting.y).toBe(cars.y)
    expect(rate.y).toBeGreaterThan(cars.y)
  })

  test('a grid cell still opens 車流熱力 at that gateway and slot', async ({ browser }) => {
    const page = await open(browser, 390, 844)
    const grid = page.getByRole('grid', { name: '今天各入口每 15 分鐘的路況' })
    const cell = grid.getByRole('gridcell', { name: /內湖路一段 07:15–/ })
    await cell.scrollIntoViewIfNeeded()
    await cell.click()
    await expect(page.getByRole('tab', { name: '車流熱力' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('group', { name: '時段' }).getByRole('button', { name: '07:15–07:30' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('region', { name: '選取的入口' }).getByRole('heading')).toContainText('內湖路一段')
    expect(await page.evaluate(() => scrollY)).toBe(0)
  })

  test('simulated data is still marked (REQ-063)', async ({ browser }) => {
    const page = await open(browser, 390, 844)
    await expect(page.getByText('模擬時間')).toBeVisible()
    await expect(page.getByRole('region', { name: '估計減少的車次' }).getByText('估算')).toBeVisible()
    await expect(page.getByRole('region', { name: '入口 × 15 分鐘' }).getByText('今天：模擬')).toBeVisible()
    await page.getByRole('tab', { name: '即時地圖' }).click()
    await expect(page.getByRole('region', { name: '此刻在路上' }).getByText('含模擬')).toBeVisible()
    await page.getByRole('tab', { name: '車流熱力' }).click()
    await expect(page.getByTestId('map-slot').getByText('模擬')).toBeVisible()
  })
})

// The static site's 首頁 link pads the header's first child on narrow screens (T68's contract).
const HOME_LINK_PADDING = '@media (max-width: 1023.98px) { #root header > :first-child { padding-left: 56px } }'

for (const [width, homeLink] of [[360, false], [360, true], [768, true], [1023, true]] as const) {
  test(`${width}px${homeLink ? ' with the static site 首頁 padding' : ''}: the name ends left of the clock (T71, T72, T68)`, async ({ browser }) => {
    const page = await open(browser, width, 780)
    if (homeLink) await page.addStyleTag({ content: HOME_LINK_PADDING })
    const ends = await page.evaluate(() => {
      const h1 = document.querySelector('header h1')!
      const range = document.createRange()
      range.selectNodeContents(h1)
      const clock = [...document.querySelectorAll('header > div')].find((d) => d.textContent?.includes('週'))!
      return { name: Math.max(...[...range.getClientRects()].map((r) => r.right)), clock: clock.getBoundingClientRect().left }
    })
    expect(ends.name).toBeLessThanOrEqual(ends.clock)
    await expect(page.getByText('市府儀表板')).toBeVisible()
    await expect(page.getByText('模擬時間')).toBeVisible()
  })
}

for (const [width, height] of [[1440, 900], [1920, 1080]]) {
  test(`${width}×${height}: every tab fits one screen, no page scroll (T71, T72)`, async ({ browser }) => {
    const page = await open(browser, width, height)
    for (const name of TABS) {
      await page.getByRole('tab', { name }).click()
      const m = await measure(page)
      expect([m.overflowX, m.overflowY], name).toEqual([0, 0])
      // Desktop: the tab fills the screen under the bar, nothing scrolls inside it either.
      expect(await page.locator('main > div').evaluate((e) => e.scrollHeight - e.clientHeight), name).toBe(0)
    }
  })
}

// T72: a desktop window too short for the 16 gateway rows scrolls 總覽 instead of letting them spill.
for (const [width, height] of [[1440, 760], [1512, 860], [1280, 800], [1024, 768]]) {
  test(`${width}×${height} 總覽: the 16 rows stay in the grid, above its legend and the panels below; all areas scroll into view (T72)`, async ({ browser }) => {
    const page = await open(browser, width, height)
    const grid = page.getByRole('grid', { name: '今天各入口每 15 分鐘的路況' })
    await expect(grid.getByRole('rowheader')).toHaveCount(16)
    const boxes = await grid.evaluate((g) => {
      const panel = g.closest('section')!
      const bottom = (e: Element) => e.getBoundingClientRect().bottom
      const cells = [...g.querySelectorAll('[role=gridcell]')]
      const history = document.querySelector('[aria-label="過去 10 個上班日的共乘數"]')!
      return {
        overflow: g.scrollHeight - g.clientHeight,
        lastRow: bottom(cells[cells.length - 1]),
        gridBottom: bottom(g),
        legendTop: g.nextElementSibling!.getBoundingClientRect().top,
        panelBottom: bottom(panel),
        historyTop: history.getBoundingClientRect().top,
        rowHeight: cells[0].getBoundingClientRect().height,
      }
    })
    expect(boxes.overflow).toBe(0)
    expect(boxes.lastRow).toBeLessThanOrEqual(boxes.gridBottom + 0.5)
    expect(boxes.legendTop).toBeGreaterThanOrEqual(boxes.gridBottom - 0.5)
    expect(boxes.historyTop).toBeGreaterThanOrEqual(boxes.panelBottom)
    expect(boxes.rowHeight).toBeGreaterThanOrEqual(13)
    // Every area can be scrolled into view.
    for (const name of ['估計減少的車次', '入口 × 15 分鐘', '今天的請求', '過去 10 個上班日的共乘數', '各上車點']) {
      const area = page.getByRole('region', { name, exact: true })
      await area.scrollIntoViewIfNeeded()
      await expect(area, name).toBeInViewport()
    }
  })
}

// T72: 768–1023px uses T71's single column.
for (const [width, height] of [[768, 1024], [820, 1180]]) {
  test(`${width}×${height}: every tab in one column, no sideways page scroll, slot cells at least 40px (T72)`, async ({ browser }) => {
    const page = await open(browser, width, height)
    for (const name of TABS) {
      await page.getByRole('tab', { name }).click()
      expect((await measure(page)).overflowX, name).toBe(0)
    }
    await page.getByRole('tab', { name: '總覽' }).click()
    const cell = (await page.getByRole('grid', { name: '今天各入口每 15 分鐘的路況' }).getByRole('gridcell').first().boundingBox())!
    expect(cell.width).toBeGreaterThanOrEqual(40)
    // One column: the grid panel sits above today's requests, not beside them.
    const grid = (await page.getByRole('region', { name: '入口 × 15 分鐘', exact: true }).boundingBox())!
    const requests = (await page.getByRole('region', { name: '今天的請求', exact: true }).boundingBox())!
    expect(requests.y).toBeGreaterThanOrEqual(grid.y + grid.height)
    await page.getByRole('tab', { name: '車流熱力' }).click()
    const trafficCell = (await page.getByRole('grid', { name: '所選日期各入口每 15 分鐘的路況' }).getByRole('gridcell').first().boundingBox())!
    expect(trafficCell.width).toBeGreaterThanOrEqual(40)
  })
}
