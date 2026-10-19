import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('passenger App', () => {
  it('renders inside the phone shell', () => {
    render(<App />)
    expect(screen.getByText('乘客')).toBeInTheDocument()
    expect(screen.getByText('模擬車輛')).toBeInTheDocument()
  })
})
