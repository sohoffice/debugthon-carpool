import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DriverDebugMode } from './DriverDebugMode'

describe('driver debug mode (SC-X2)', () => {
  it('switches the main screen driver and has no simulator: it runs on the showcase (DD-14)', () => {
    render(<DriverDebugMode />)
    fireEvent.click(screen.getByRole('button', { name: '除錯' }))

    const accounts = screen.getByRole('radiogroup', { name: '主畫面的駕駛' })
    expect(Array.from(accounts.querySelectorAll('[role=radio]')).map((a) => a.textContent)).toEqual(['driver1', 'driver2', 'driver3', 'driver4', 'driver5'])
    expect(screen.getByRole('radio', { name: 'driver5' })).toHaveAttribute('href', expect.stringContaining('account=driver5'))
    expect(screen.queryByRole('button', { name: '開始模擬' })).not.toBeInTheDocument()
    expect(screen.queryByText('模擬器')).not.toBeInTheDocument()
  })
})
