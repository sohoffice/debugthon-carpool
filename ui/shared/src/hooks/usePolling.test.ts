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

  it('pauses while the page is hidden and polls at once when it is shown again', async () => {
    let hidden = false
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => (hidden ? 'hidden' : 'visible'))
    const setHidden = (value: boolean) => act(() => ((hidden = value), document.dispatchEvent(new Event('visibilitychange'))))
    const fetcher = vi.fn(async () => 1)
    renderHook(() => usePolling(fetcher, INTERVAL))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetcher).toHaveBeenCalledTimes(1)

    setHidden(true)
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL * 5))
    expect(fetcher).toHaveBeenCalledTimes(1)

    setHidden(false)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetcher).toHaveBeenCalledTimes(2)
    vi.restoreAllMocks()
  })

  it('mutate shows new data at once and drops a poll that was already in flight', async () => {
    let resolveSlow: (v: string) => void = () => {}
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockImplementationOnce(() => new Promise((r) => (resolveSlow = r)))
      .mockResolvedValue('later')
    const { result } = renderHook(() => usePolling(fetcher, INTERVAL))
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL))

    act(() => result.current.mutate('from action'))
    await act(async () => resolveSlow('stale'))
    expect(result.current.data).toBe('from action')

    await act(() => vi.advanceTimersByTimeAsync(INTERVAL))
    expect(result.current.data).toBe('later')
  })

  it('a new restartKey polls at once with the new fetcher and drops the old poll in flight', async () => {
    let resolveOld: (v: string) => void = () => {}
    const old = vi.fn(() => new Promise<string>((r) => (resolveOld = r)))
    const fresh = vi.fn(async () => 'new')
    const { result, rerender } = renderHook(({ key, fetcher }) => usePolling(fetcher, INTERVAL, true, key), {
      initialProps: { key: 'a', fetcher: old as () => Promise<string> },
    })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(old).toHaveBeenCalledTimes(1)

    rerender({ key: 'b', fetcher: fresh })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fresh).toHaveBeenCalledTimes(1)
    expect(result.current.data).toBe('new')

    await act(async () => resolveOld('old'))
    expect(result.current.data).toBe('new')
  })
})
