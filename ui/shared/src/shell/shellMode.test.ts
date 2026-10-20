import { describe, expect, it } from 'vitest'
import { getShellMode } from './shellMode'

describe('getShellMode', () => {
  it('uses the phone frame only on wide viewports', () => {
    expect(getShellMode('', 1280)).toBe('framed')
    expect(getShellMode('', 600)).toBe('framed')
    expect(getShellMode('', 390)).toBe('phone')
  })

  it('never draws its own frame when embedded by the showcase page', () => {
    expect(getShellMode('?embed=1&account=driver4', 1280)).toBe('embed')
    expect(getShellMode('?embed=0', 1280)).toBe('framed')
  })
})
