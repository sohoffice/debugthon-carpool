import { describe, expect, it } from 'vitest'
import { nextHeading, shortestTurn, shouldJump } from './vehicleMotion'

const A = { lat: 25.05, lng: 121.578 }
const metresNorth = (m: number) => ({ lat: A.lat + m / 111195, lng: A.lng })

describe('vehicle motion (UD-15)', () => {
  it('turns the shorter way round', () => {
    expect(shortestTurn(350, 10)).toBe(20)
    expect(shortestTurn(10, 350)).toBe(-20)
    expect(shortestTurn(90, 270)).toBe(-180)
  })

  it('uses the reported heading, else the direction of travel, and ignores tiny moves', () => {
    expect(nextHeading(A, metresNorth(50), 135, 0)).toBe(135)
    expect(nextHeading(A, metresNorth(50), null, 200)).toBeCloseTo(0, 0)
    expect(nextHeading(A, metresNorth(3), null, 200)).toBe(200)
  })

  it('jumps instead of animating over long distances or after missed polls', () => {
    expect(shouldJump(A, metresNorth(100), 0)).toBe(false)
    expect(shouldJump(A, metresNorth(400), 0)).toBe(true)
    expect(shouldJump(A, metresNorth(100), 3)).toBe(true)
  })
})
