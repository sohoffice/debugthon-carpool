import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCATION_REPORT_MS } from './config'
import { useLocationReporting } from './useLocationReporting'

const NEAR_SONGSHAN = { lat: 25.05003, lng: 121.578206 }
const NEAR_WTC = { lat: 25.033375, lng: 121.5619 }

function fakeBackend() {
  const reports: { lat: number; lng: number }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === '/api/location' && init.method === 'POST') reports.push(JSON.parse(String(init.body)))
      return new Response('{}', { status: 201 })
    }),
  )
  return reports
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('location reporting (DD-25, DD-26)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps reporting while taking part, with the position moved in the debug mode', async () => {
    const reports = fakeBackend()
    const { rerender } = renderHook(({ position, active }) => useLocationReporting(position, active), {
      initialProps: { position: NEAR_SONGSHAN, active: true },
    })

    await advance(3 * LOCATION_REPORT_MS)
    expect(reports).toEqual([NEAR_SONGSHAN, NEAR_SONGSHAN, NEAR_SONGSHAN])

    // Moved in the debug mode: the next report carries the new position.
    rerender({ position: NEAR_WTC, active: true })
    await advance(LOCATION_REPORT_MS)
    expect(reports.at(-1)).toEqual(NEAR_WTC)

    // The request is over: no more reports.
    rerender({ position: NEAR_WTC, active: false })
    await advance(3 * LOCATION_REPORT_MS)
    expect(reports).toHaveLength(4)
  })
})
