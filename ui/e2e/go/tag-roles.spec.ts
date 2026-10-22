import { expect, test } from '@playwright/test'
import { API, DRIVER4, driveTowardsPickup, DRIVER_URL, PASSENGER_URL, pickStageTags, requestWithStageTagsRequired, resetDemo, tagId } from './support'

/** 女性友善's id on a seeded database; T43 dropped the tag (DD-42). */
const DROPPED_TAG_ID = 6

test.beforeEach(async ({ request }) => resetDemo(request))
test.afterEach(async ({ request }) => resetDemo(request))

test('tags by side on Go: 只載 is required, an old filter is dropped, 最好 relaxes (REQ-013, REQ-047, REQ-085, REQ-086, DD-42)', async ({ browser, request }) => {
  const driver = await (await browser.newContext()).newPage()
  const passengerContext = await browser.newContext()
  // A filter this browser remembered from before T43, which the backend now refuses (REQ-085).
  await passengerContext.addInitScript((id) => {
    if (!localStorage.getItem('carpool.filters.passenger1')) {
      localStorage.setItem('carpool.filters.passenger1', JSON.stringify([{ tag_id: id, intent: 'required' }]))
    }
  }, DROPPED_TAG_ID)
  const passenger = await passengerContext.newPage()
  await driver.goto(DRIVER_URL)
  await passenger.goto(PASSENGER_URL)

  // The driver: 只載 is a switch in the driver's words, no 建議; on means required (REQ-013, REQ-015).
  await expect(driver.getByRole('button', { name: /目的地\s*瑞光路 513 巷/ })).toBeVisible()
  await pickStageTags(driver)
  await expect(driver.getByRole('button', { name: /只載\s*不限/ })).toBeVisible()
  await driver.getByRole('button', { name: /只載/ }).click()
  await driver.getByRole('switch', { name: '不抽菸的乘客' }).click()
  await expect(driver.getByRole('button', { name: /只載\s*不抽菸的乘客/ })).toBeVisible()
  await expect(driver.getByText(/建議|強制/)).toHaveCount(0)
  await driver.getByRole('button', { name: '我出發了' }).click()
  await expect(driver.getByRole('heading', { name: /目前沒有/ })).toBeVisible()
  const trip = await (await request.get(`${API}/driver/trips/current`, { headers: DRIVER4 })).json()
  expect(trip.tag_filters.map((f: { tag_id: number; intent: string }) => [f.tag_id, f.intent])).toEqual([[await tagId(request, '不抽菸'), 'required']])
  await driveTowardsPickup(request)

  // The passenger: the board loads although the old filter is still in the browser.
  const board = passenger.getByRole('region', { name: '松山車站的接近車輛' })
  await expect(board.getByText(/^\d+ 台車接近中$/)).toBeVisible()
  expect(await passenger.evaluate(() => localStorage.getItem('carpool.filters.passenger1'))).toBe('[]')

  // driver4 only takes non-smokers, so passenger1 says so in 關於我 (REQ-008, REQ-086).
  await passenger.getByRole('button', { name: '修改', exact: true }).click()
  const about = passenger.getByRole('group', { name: '關於我' })
  await about.getByRole('button', { name: '我不抽菸', exact: true }).click()
  await expect(about.getByRole('button', { name: '我不抽菸', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(about.getByRole('button', { name: /能放大件行李/ })).toHaveCount(0)
  await passenger.getByRole('button', { name: '查看接近的車' }).click()
  await expect(board.getByText(/^\d+ 台車接近中$/)).toBeVisible()

  // Both stage tags 一定要 and 安靜坐車 最好: driver4 gets it without 開車喜歡安靜, so it is relaxed (REQ-047).
  await requestWithStageTagsRequired(passenger, { preferQuiet: true })
  await expect(passenger.getByRole('heading', { name: '正在等駕駛確認' })).toBeVisible()
  await expect(driver.getByRole('heading', { name: '有乘客要搭車' })).toBeVisible()
  await driver.getByRole('button', { name: '確認' }).click()
  await expect(passenger.getByText('這台車沒有全部符合你選「最好」的條件')).toBeVisible()
  await expect(passenger.getByText('ABC-0004', { exact: true })).toBeVisible()
  await Promise.all([driver.context().close(), passengerContext.close()])
})
