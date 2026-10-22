import { expect, test, type Page } from '@playwright/test'
import { E2E_PORTS } from '../playwright.config'

const API = `http://localhost:${E2E_PORTS.mock}/api`
const PASSENGER_URL = `http://localhost:${E2E_PORTS.passenger}/?account=passenger1`

test.beforeEach(async ({ request }) => {
  // No car, so the request ends at once and the passenger can go back to the destination setup.
  expect((await request.post(`${API}/_mock/scenario`, { data: { scenario: 'no_cars' } })).ok()).toBe(true)
})
test.afterEach(async ({ request }) => {
  expect((await request.post(`${API}/_mock/scenario`, { data: { scenario: 'normal' } })).ok()).toBe(true)
})

/** 關於我 on the destination setup, opened from the board. */
async function aboutOnSetup(passenger: Page) {
  await passenger.getByRole('button', { name: '修改', exact: true }).click()
  return passenger.getByRole('group', { name: '關於我' })
}

test('關於我 changed in the send sheet is saved for the passenger (REQ-008, REQ-040, REQ-086, DD-42)', async ({ page: passenger }) => {
  await passenger.goto(PASSENGER_URL)
  await passenger.getByRole('button', { name: '今天我要搭' }).click()
  const sheet = passenger.getByRole('dialog', { name: '送出搭車請求' })
  await expect(sheet.getByText('不限', { exact: true })).toBeVisible()

  // Only passenger tags, in the passenger's words.
  await sheet.getByRole('button', { name: '修改', exact: true }).click()
  const about = sheet.getByRole('group', { name: '關於我' })
  await expect(about.getByRole('button')).toHaveText(['我不抽菸', '喜歡安靜', '可以聊天'])
  await about.getByRole('button', { name: '喜歡安靜', exact: true }).click()
  await expect(about.getByRole('button', { name: '喜歡安靜', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet.getByText('喜歡安靜', { exact: true }).first()).toBeVisible()

  await sheet.getByRole('button', { name: '送出請求' }).click()
  await expect(passenger.getByRole('heading', { name: '目前沒有可搭的車' })).toBeVisible()
  await passenger.getByRole('button', { name: '回去看接近的車' }).click()

  await expect((await aboutOnSetup(passenger)).getByRole('button', { name: '喜歡安靜', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // From the backend, not this page's state.
  await passenger.reload()
  await expect((await aboutOnSetup(passenger)).getByRole('button', { name: '喜歡安靜', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
