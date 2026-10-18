import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('passenger App', () => {
  it('renders the shell and a map placeholder when no Maps key is set', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: '內科順路共乘 · 乘客' })).toBeInTheDocument()
    expect(screen.getByText(/地圖未設定/)).toBeInTheDocument()
  })
})
