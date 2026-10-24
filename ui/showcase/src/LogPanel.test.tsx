import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LogEntry } from './log'
import { LogPanel } from './LogPanel'

const entries = (n: number): LogEntry[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, time: '16:30:02', text: `第 ${i + 1} 筆`, error: false }))

/** jsdom has no layout: give the list a fixed size so scroll positions mean something. */
function sizeList(list: HTMLElement, scrollHeight: number) {
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 })
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: scrollHeight })
}

describe('log panel (UD-30 part 2)', () => {
  it('follows new entries at the bottom, but not after the speaker scrolled up', () => {
    const { rerender } = render(<LogPanel entries={entries(20)} onClose={() => {}} />)
    const list = screen.getByRole('list', { name: '紀錄' })
    sizeList(list, 1000)
    rerender(<LogPanel entries={entries(21)} onClose={() => {}} />)
    expect(list.scrollTop).toBe(1000)

    list.scrollTop = 300
    fireEvent.scroll(list)
    sizeList(list, 1050)
    rerender(<LogPanel entries={entries(22)} onClose={() => {}} />)
    expect(list.scrollTop).toBe(300)

    // Back at the bottom: following again.
    list.scrollTop = 850
    fireEvent.scroll(list)
    sizeList(list, 1100)
    rerender(<LogPanel entries={entries(23)} onClose={() => {}} />)
    expect(list.scrollTop).toBe(1100)
  })

  it('closes with ✕ or Esc, and focuses ✕ when opened', () => {
    const onClose = vi.fn()
    render(<LogPanel entries={entries(1)} onClose={onClose} />)
    expect(screen.getByRole('button', { name: '收起紀錄' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: '收起紀錄' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '收起紀錄' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
