import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

const TAGS = [
  { id: 1, name: '不抽菸' },
  { id: 2, name: '可載行李' },
  { id: 3, name: '安靜通勤' },
]

interface Call {
  method: string
  url: string
  account: string
}

/** A backend with no trips; `down` makes every call fail like the dev proxy without a backend. */
function fakeBackend() {
  const state = { down: false, d4Trip: null as number | null }
  const trip = { id: 40, auto_accept: false, pickup_point: { id: 1 }, destination: { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 } }
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const account = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '').split(':')[1] ?? ''
      calls.push({ method, url, account })
      if (state.down) return new Response('', { status: 502 })
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      if (url === '/api/demo/reset') return new Response(null, { status: 204 })
      if (url === '/api/tags') return reply(TAGS)
      if (url.startsWith('/api/me/tags/')) return new Response(null, { status: 204 })
      const d4 = account === 'driver4' ? state.d4Trip : null
      if (url === '/api/driver/requests') return reply({ trip_id: d4, pending: [], passengers: [] })
      if (url === '/api/driver/trips/current' && d4 !== null) return reply(trip)
      if (url === '/api/location') return reply({}, 201)
      if (url === '/api/driver/trips' && method === 'POST') return reply({ id: 50 }, 201)
      if (url === '/api/driver/trips/current') return reply({ error: { code: 'not_found', message: '目前沒有進行中的行程' } }, 404)
      return reply({ error: { code: 'not_found', message: '' } }, 404)
    }),
  )
  const sequence = () => calls.filter((c) => c.method !== 'GET' || c.url === '/api/driver/trips/current').map((c) => `${c.method} ${c.url} ${c.account}`.trim())
  return { state, calls, sequence }
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
const press = (name: string) => act(async () => fireEvent.click(screen.getByRole('button', { name })))
const phoneSrcs = () => [screen.getByTitle('駕駛 App'), screen.getByTitle('乘客 App')]

function openLog() {
  fireEvent.click(screen.getByRole('button', { name: /^紀錄/ }))
  return within(screen.getByRole('list', { name: '紀錄' }))
}

describe('showcase App (UD-18, UD-30, DD-45)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('embeds both phones and the war room, and starts nothing until 開始 Demo', async () => {
    const backend = fakeBackend()
    render(<App />)
    expect(screen.getByTitle('駕駛 App')).toHaveAttribute('src', expect.stringContaining('embed=1&account=driver4'))
    expect(screen.getByTitle('乘客 App')).toHaveAttribute('src', expect.stringContaining('embed=1&account=passenger1'))
    // Loaded from the start, so the first switch already shows data (UD-30 part 3).
    expect(screen.getByTitle('市府戰情室')).toHaveAttribute('src', expect.stringMatching(/:5175\/\?account=city1$/))

    expect(screen.getByRole('button', { name: '開始 Demo' })).toBeInTheDocument()
    await advance(5000)
    // No simulator, no off-stage rounds, no tags.
    expect(backend.calls).toEqual([])
  })

  it('開始 Demo resets, tags driver4 and driver5, starts the simulator and reloads both phones, in order', async () => {
    const backend = fakeBackend()
    render(<App />)
    const before = phoneSrcs()

    fireEvent.click(screen.getByRole('button', { name: '開始 Demo' }))
    expect(screen.getByRole('button', { name: '執行中…' })).toHaveAttribute('aria-disabled', 'true')
    await advance(0)

    expect(screen.getByRole('button', { name: '重新開始' })).toBeInTheDocument()
    expect(backend.sequence().slice(0, 9)).toEqual([
      'POST /api/demo/reset',
      // 不抽菸 and 安靜通勤 on, the earlier 可載行李 off (T65).
      'PUT /api/me/tags/1 driver4',
      'PUT /api/me/tags/3 driver4',
      'DELETE /api/me/tags/2 driver4',
      'PUT /api/me/tags/1 driver5',
      'PUT /api/me/tags/3 driver5',
      'DELETE /api/me/tags/2 driver5',
      // driver3 is seeded with both stage tags: it drops 安靜通勤.
      'DELETE /api/me/tags/3 driver3',
      // The simulator looks up the first driver's trip.
      'GET /api/driver/trips/current driver1',
    ])
    // Remounted iframes: both phones reloaded.
    const after = phoneSrcs()
    expect(after[0]).not.toBe(before[0])
    expect(after[1]).not.toBe(before[1])

    const log = openLog()
    expect(log.getAllByRole('listitem').map((li) => li.textContent?.slice(8))).toEqual([
      '開始 Demo：資料已重設',
      '標籤已選好：driver4、driver5 都帶「不抽菸」「安靜通勤」',
      '模擬器開始了',
    ])
  })

  it('a start with the backend down goes back to 開始 Demo, says so and lights the log dot', async () => {
    const backend = fakeBackend()
    backend.state.down = true
    render(<App />)
    await press('開始 Demo')

    expect(screen.getByRole('button', { name: '開始 Demo' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('開始失敗，請確認後端有在執行。')
    expect(screen.getByRole('button', { name: '紀錄，有新的錯誤' })).toBeInTheDocument()
    expect(screen.getByTestId('log-error-dot')).toBeInTheDocument()
    // The simulator did not start.
    expect(backend.calls.some((c) => c.url === '/api/driver/trips/current')).toBe(false)

    const log = openLog()
    expect(log.getAllByRole('listitem')).toHaveLength(1)
    expect(log.getByRole('listitem')).toHaveTextContent('開始失敗：重設失敗（502）')
    expect(log.getByRole('listitem')).toHaveAttribute('data-error', 'true')
    expect(screen.queryByTestId('log-error-dot')).not.toBeInTheDocument()

    // Pressing again retries from the reset and clears the message.
    backend.state.down = false
    await press('開始 Demo')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新開始' })).toBeInTheDocument()
  })

  it('重新開始 asks again and lapses after 3 s without resetting', async () => {
    const backend = fakeBackend()
    render(<App />)
    await press('開始 Demo')
    const resets = () => backend.calls.filter((c) => c.url === '/api/demo/reset').length

    await press('重新開始')
    expect(screen.getByRole('button', { name: '再按一次確定重新開始' })).toBeInTheDocument()
    await advance(2999)
    expect(screen.getByRole('button', { name: '再按一次確定重新開始' })).toBeInTheDocument()
    await advance(1)
    expect(screen.getByRole('button', { name: '重新開始' })).toBeInTheDocument()
    expect(resets()).toBe(1)
  })

  it('重新開始 twice resets and reloads both phones; the simulator keeps going and the tags are not picked again', async () => {
    const backend = fakeBackend()
    render(<App />)
    await press('開始 Demo')
    const before = phoneSrcs()
    const war = screen.getByTitle('市府戰情室')
    const tagCalls = () => backend.calls.filter((c) => c.method === 'PUT').length

    await press('重新開始')
    await press('再按一次確定重新開始')
    expect(backend.calls.filter((c) => c.url === '/api/demo/reset')).toHaveLength(2)
    expect(tagCalls()).toBe(4)
    expect(screen.getByRole('button', { name: '重新開始' })).toBeInTheDocument()
    const after = phoneSrcs()
    expect(after[0]).not.toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    // The war room is not reloaded (UD-30 part 3).
    expect(screen.getByTitle('市府戰情室')).toBe(war)

    // The simulator is still looking up trips.
    const lookups = () => backend.calls.filter((c) => c.url === '/api/driver/trips/current').length
    const n = lookups()
    await advance(2000)
    expect(lookups()).toBeGreaterThan(n)
    expect(openLog().getAllByRole('listitem').at(-1)).toHaveTextContent('重新開始：資料已重設，兩支手機重新載入')
  })

  it('a restart with the backend down says so and logs an error', async () => {
    const backend = fakeBackend()
    render(<App />)
    await press('開始 Demo')
    backend.state.down = true
    await press('重新開始')
    await press('再按一次確定重新開始')

    expect(screen.getByRole('alert')).toHaveTextContent('重新開始失敗，請確認後端有在執行。')
    expect(screen.getByRole('button', { name: '重新開始' })).toBeInTheDocument()
    expect(openLog().getAllByText(/^重新開始失敗：/)).toHaveLength(1)
  })

  it('within 2 s of driver4 departing, driver5 follows and the simulator has reported driver4 (DD-45)', async () => {
    const backend = fakeBackend()
    render(<App />)
    await press('開始 Demo')
    await advance(3000)

    backend.state.d4Trip = 40
    const from = backend.calls.length
    await advance(2000)
    const since = backend.calls.slice(from)
    expect(since).toContainEqual({ method: 'POST', url: '/api/driver/trips', account: 'driver5' })
    expect(since).toContainEqual({ method: 'POST', url: '/api/location', account: 'driver4' })
    const texts = openLog().getAllByRole('listitem').map((li) => li.textContent?.slice(8))
    expect(texts.slice(-2)).toEqual(['driver4 出發了', 'driver5 跟著出發了'])
  })

  it('the log starts closed and empty, and stays closed on errors', async () => {
    const backend = fakeBackend()
    render(<App />)
    await press('開始 Demo')
    backend.state.down = true
    await advance(3000)
    expect(screen.queryByRole('list', { name: '紀錄' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '紀錄，有新的錯誤' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '紀錄，有新的錯誤' }))
    expect(screen.getByText('連不到後端，每秒重試')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收起紀錄' }))
    expect(screen.getByRole('button', { name: '紀錄' })).toHaveFocus()
  })

  it('says 還沒有紀錄。 before anything happened', () => {
    fakeBackend()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '紀錄' }))
    expect(screen.getByText('還沒有紀錄。')).toBeInTheDocument()
  })

  it('switches to the war room and back without reloading anything; arrow keys switch too', async () => {
    fakeBackend()
    render(<App />)
    await press('開始 Demo')
    const phones = phoneSrcs()
    const war = screen.getByTitle('市府戰情室')
    const group = screen.getByRole('radiogroup', { name: '展示頁的畫面' })
    const phonesView = screen.getByRole('main', { hidden: true })

    fireEvent.click(within(group).getByRole('radio', { name: '市府戰情室' }))
    expect(within(group).getByRole('radio', { name: '市府戰情室' })).toHaveAttribute('aria-checked', 'true')
    // Hidden, still mounted: the phones keep polling.
    expect(phonesView).toHaveClass('invisible')
    expect(phonesView).toHaveAttribute('inert')
    expect(war.closest('.fixed')).not.toHaveClass('invisible')

    fireEvent.keyDown(within(group).getByRole('radio', { name: '市府戰情室' }), { key: 'ArrowLeft' })
    expect(within(group).getByRole('radio', { name: '手機' })).toHaveAttribute('aria-checked', 'true')
    expect(within(group).getByRole('radio', { name: '手機' })).toHaveFocus()
    expect(phonesView).not.toHaveClass('invisible')
    expect(war.closest('.fixed')).toHaveClass('invisible')
    expect(phoneSrcs()[0]).toBe(phones[0])
    expect(phoneSrcs()[1]).toBe(phones[1])
    expect(screen.getByTitle('市府戰情室')).toBe(war)
  })
})
