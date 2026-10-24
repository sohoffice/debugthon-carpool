import { describe, expect, it } from 'vitest'
import { isEmbedded } from './tour'

const page = (search: string, framed = false) => {
  const win = { location: { search } } as unknown as Window & { parent: Window }
  win.parent = framed ? ({} as Window) : win
  return win
}

describe('isEmbedded (DD-46: no tour inside the showcase)', () => {
  it('the static driver or passenger page on its own: tour', () => expect(isEmbedded(page('?account=driver4'))).toBe(false))
  it('?embed=1, as the showcase opens the apps: no tour', () => expect(isEmbedded(page('?embed=1&account=driver4'))).toBe(true))
  it('in a frame without embed=1: no tour either', () => expect(isEmbedded(page('', true))).toBe(true))
})
