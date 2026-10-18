import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePolling } from './usePolling'

const INTERVAL = 1000

describe('usePolling', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fetches immediately, then every interval', async () => {
    let n = 0
    const fetcher = vi.fn(async () => ++n)
    const { result } = renderHook(() => usePolling(fetcher, INTERVAL))

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.data).toBe(1)

    await act(() => vi.advanceTimersByTimeAsync(INTERVAL))
    expect(result.current.data).toBe(2)
  })

  it('keeps the last data when a poll fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('ok').mockRejectedValueOnce(new Error('down'))
    const { result } = renderHook(() => usePolling(fetcher, INTERVAL))

    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL))

    expect(result.current.data).toBe('ok')
    expect(result.current.error?.message).toBe('down')
  })

  it('stops polling when disabled or unmounted', async () => {
    const fetcher = vi.fn(async () => 1)
    const { rerender, unmount } = renderHook(({ enabled }) => usePolling(fetcher, INTERVAL, enabled), {
      initialProps: { enabled: true },
    })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetcher).toHaveBeenCalledTimes(1)

    rerender({ enabled: false })
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL * 3))
    expect(fetcher).toHaveBeenCalledTimes(1)

    rerender({ enabled: true })
    await act(() => vi.advanceTimersByTimeAsync(0))
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL * 3))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
