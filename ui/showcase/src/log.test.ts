import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { appendEntry, clockTime, LOG_LIMIT, useLog, type LogEntry } from './log'

const entry = (id: number): LogEntry => ({ id, time: '16:30:02', text: `第 ${id} 筆`, error: false })

describe('the speaker log (UD-30 part 2)', () => {
  it('keeps only the latest 50, newest last, without touching the old list', () => {
    expect(LOG_LIMIT).toBe(50)
    const full = Array.from({ length: LOG_LIMIT }, (_, i) => entry(i + 1))
    const next = appendEntry(full, entry(51))
    expect(next).toHaveLength(50)
    expect(next[0].id).toBe(2)
    expect(next.at(-1)?.id).toBe(51)
    expect(full).toHaveLength(50)
    expect(appendEntry(full.slice(0, 49), entry(50))).toHaveLength(50)
  })

  it('shows wall-clock 時:分:秒 in 24 hours', () => {
    expect(clockTime(new Date(2026, 9, 24, 16, 30, 2))).toBe('16:30:02')
    expect(clockTime(new Date(2026, 9, 24, 0, 5, 9))).toBe('00:05:09')
  })

  it('never opens by itself; an error lights the dot until the log is opened', () => {
    const { result } = renderHook(() => useLog())
    act(() => result.current.add('模擬器開始了'))
    expect(result.current.unseenError).toBe(false)
    act(() => result.current.add('連不到後端，每秒重試', true))
    expect(result.current.open).toBe(false)
    expect(result.current.unseenError).toBe(true)

    act(() => result.current.show())
    expect(result.current.unseenError).toBe(false)
    // An error while it is open is seen already.
    act(() => result.current.add('driver5 出發失敗：x', true))
    expect(result.current.unseenError).toBe(false)
    act(() => result.current.hide())
    act(() => result.current.add('重新開始失敗：x', true))
    expect(result.current.unseenError).toBe(true)
    expect(result.current.entries.map((e) => e.error)).toEqual([false, true, true, true])
  })
})
