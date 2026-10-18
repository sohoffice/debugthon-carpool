import { describe, expect, it } from 'vitest'
import { getAccountFromUrl } from './account'

describe('getAccountFromUrl', () => {
  it('reads ?account=', () => {
    expect(getAccountFromUrl('driver1', '?account=driver3')).toBe('driver3')
  })

  it('falls back when missing or malformed', () => {
    expect(getAccountFromUrl('driver1', '')).toBe('driver1')
    expect(getAccountFromUrl('driver1', '?account=a:b')).toBe('driver1')
  })
})
