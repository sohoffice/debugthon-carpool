import type { CityGateway } from '@carpool/shared'
import { describe, expect, it } from 'vitest'
import { congestionLevel, gatewayLevel, vsUsualLevel, worstLevel } from './congestion'

const gateway = (speed: number | null, reference = 60) => ({ avg_speed_kmh: speed, reference_speed_kmh: reference }) as CityGateway

describe('congestion levels (DD-44, UD-28)', () => {
  it('splits speed ÷ reference at 75%, 50% and 30%, each threshold on its own side', () => {
    expect(congestionLevel(1.2)).toBe(1)
    expect(congestionLevel(0.75)).toBe(1)
    expect(congestionLevel(0.7499)).toBe(2)
    expect(congestionLevel(0.5)).toBe(2)
    expect(congestionLevel(0.4999)).toBe(3)
    expect(congestionLevel(0.3)).toBe(3)
    expect(congestionLevel(0.2999)).toBe(4)
    expect(congestionLevel(0)).toBe(4)
  })

  it('a gateway is levelled by its own reference speed; no speed is no data', () => {
    expect(gatewayLevel(gateway(45, 60))).toBe(1) // 75%
    expect(gatewayLevel(gateway(29, 60))).toBe(3) // 48%
    expect(gatewayLevel(gateway(29, 30))).toBe(1) // the same speed on a slow road is fine
    expect(gatewayLevel(gateway(null))).toBeNull()
  })

  it('the worst level and how many gateways have it; no data is left out', () => {
    expect(worstLevel([1, 3, null, 3, 2])).toEqual({ level: 3, count: 2 })
    expect(worstLevel([null, null])).toBeNull()
  })

  it('比平常 compares with the other days at the same time: +10% 快, ±10% 差不多, −10–25%, −25% or more (DD-44)', () => {
    expect(vsUsualLevel(56, 50)).toBe(1)
    expect(vsUsualLevel(55, 50)).toBe(1) // +10% is 快
    expect(vsUsualLevel(54.9, 50)).toBe(2)
    expect(vsUsualLevel(50, 50)).toBe(2)
    expect(vsUsualLevel(45, 50)).toBe(2) // −10% is still 差不多: a threshold goes to the better side, as in congestionLevel
    expect(vsUsualLevel(44.9, 50)).toBe(3)
    expect(vsUsualLevel(37.5, 50)).toBe(3) // −25% is still 慢 10–25%
    expect(vsUsualLevel(37.4, 50)).toBe(4)
    expect(vsUsualLevel(10, 50)).toBe(4)
  })
})
