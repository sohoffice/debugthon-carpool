import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

describe('showcase App', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows both apps embedded and resets only on a second tap (UD-18)', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    expect(screen.getByTitle('駕駛 App')).toHaveAttribute('src', expect.stringContaining('embed=1&account=driver4'))
    expect(screen.getByTitle('乘客 App')).toHaveAttribute('src', expect.stringContaining('embed=1&account=passenger1'))

    fireEvent.click(screen.getByRole('button', { name: '重設' }))
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '再按一次確定重設' })))
    expect(fetchMock).toHaveBeenCalledWith('/api/demo/reset', { method: 'POST' })
  })
})
