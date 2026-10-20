import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmTextButton } from './ConfirmTextButton'

describe('ConfirmTextButton', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('acts only on a second tap within 3 seconds', () => {
    const onConfirm = vi.fn()
    render(<ConfirmTextButton label="取消請求" confirmLabel="再按一次確定取消" onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: '取消請求' }))
    act(() => vi.advanceTimersByTime(3100))
    fireEvent.click(screen.getByRole('button', { name: '取消請求' }))
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '再按一次確定取消' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
