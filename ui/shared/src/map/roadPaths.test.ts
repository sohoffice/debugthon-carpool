import { describe, expect, it } from 'vitest'
import { pathAlongBearing, pathAround } from './roadPaths'
import { distanceM } from './vehicleMotion'

// A straight line due east along 25°N, a point every ~100 m (1° of longitude ≈ 100.9 km there).
const STEP = 100 / 100900
const EAST = Array.from({ length: 21 }, (_, i) => ({ lat: 25, lng: 121.5 + i * STEP }))
const length = (path: { lat: number; lng: number }[]) => path.slice(1).reduce((m, p, i) => m + distanceM(path[i], p), 0)

describe('road segment paths (UD-28)', () => {
  it('a shape is cut to about 320 m either side of the nearest point, in its own order', () => {
    const around = pathAround({ lat: 25.0001, lng: EAST[10].lng }, EAST, 320)
    expect(around).toEqual(EAST.slice(7, 14))
    expect(around![0].lng).toBeLessThan(around![around!.length - 1].lng)
  })

  it('near the end of a shape it keeps what is there', () => {
    expect(pathAround(EAST[1], EAST, 320)).toEqual(EAST.slice(0, 5))
  })

  it('a shape too short to give two points gives nothing, so the caller falls back to the bearing', () => {
    expect(pathAround(EAST[0], [EAST[0]], 320)).toBeNull()
    expect(pathAround(EAST[0], [], 320)).toBeNull()
  })

  it('without a shape: a straight line through the point in the direction of travel, the given length', () => {
    const north = pathAlongBearing({ lat: 25, lng: 121.5 }, 0, 520)
    expect(north).toHaveLength(2)
    expect(north[0].lat).toBeLessThan(25)
    expect(north[1].lat).toBeGreaterThan(25)
    expect(length(north)).toBeCloseTo(520, -1)
    const west = pathAlongBearing({ lat: 25, lng: 121.5 }, 270, 520)
    expect(west[0].lng).toBeGreaterThan(121.5)
    expect(west[1].lng).toBeLessThan(121.5)
    expect(length(west)).toBeCloseTo(520, -1)
  })
})
