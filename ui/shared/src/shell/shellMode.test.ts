import { describe, expect, it } from 'vitest'
import { getShellMode } from './shellMode'

const DESKTOP = { search: '', touch: false }
const TOUCH = { search: '', touch: true }

describe('getShellMode', () => {
  it('uses the phone frame only on wide viewports', () => {
    expect(getShellMode({ ...DESKTOP, width: 1280, height: 800 })).toBe('framed')
    expect(getShellMode({ ...DESKTOP, width: 600, height: 900 })).toBe('framed')
    expect(getShellMode({ ...DESKTOP, width: 599, height: 900 })).toBe('phone')
    expect(getShellMode({ ...DESKTOP, width: 390, height: 844 })).toBe('phone')
  })

  it('keeps the frame in a short desktop window: only a touch screen is a phone on its side (UD-13, T83)', () => {
    expect(getShellMode({ ...DESKTOP, width: 1280, height: 500 })).toBe('framed')
  })

  it('shows a phone turned on its side full screen (UD-13, T83)', () => {
    expect(getShellMode({ ...TOUCH, width: 844, height: 390 })).toBe('phone')
    expect(getShellMode({ ...TOUCH, width: 667, height: 375 })).toBe('phone')
    expect(getShellMode({ ...TOUCH, width: 932, height: 599 })).toBe('phone')
  })

  it('keeps the frame on a touch screen tall enough for it, e.g. an iPad on its side (UD-13, T83)', () => {
    expect(getShellMode({ ...TOUCH, width: 932, height: 600 })).toBe('framed')
    expect(getShellMode({ ...TOUCH, width: 1024, height: 768 })).toBe('framed')
  })

  it('never draws its own frame when embedded by the showcase page', () => {
    expect(getShellMode({ ...DESKTOP, search: '?embed=1&account=driver4', width: 1280, height: 800 })).toBe('embed')
    expect(getShellMode({ ...TOUCH, search: '?embed=1', width: 844, height: 390 })).toBe('embed')
    expect(getShellMode({ ...DESKTOP, search: '?embed=0', width: 1280, height: 800 })).toBe('framed')
  })
})
