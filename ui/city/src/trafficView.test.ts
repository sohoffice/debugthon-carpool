import type { CityGateway, CityTrafficDay, CityTrafficSlot } from '@carpool/shared'
import { describe, expect, it } from 'vitest'
import { defaultGateway, gatewayPath, readCell, slowestThree, sourceOf, tooltipLines } from './trafficView'
import { DAY_SLOTS } from './trafficSlots'

const NOW = '2026-10-26T08:15:00+08:00'

function gw(order: number, speed: number | null, past: number | null = 50, extra: Partial<CityGateway> = {}): CityGateway {
  return {
    vd_id: `V${order}`,
    source: 'city',
    gateway: `入口${order}`,
    road_name: '',
    road_direction: 'N',
    bearing: 'E',
    sort_order: order,
    location_note: '區界外',
    lat: 25,
    lng: 121.5,
    shape: null,
    proxy: false,
    proxy_note: null,
    reference_speed_kmh: 60,
    volume: speed === null ? null : 120,
    avg_speed_kmh: speed,
    occupancy_pct: speed === null ? null : 12,
    coverage_pct: speed === null ? null : 100,
    past_avg_speed_kmh: past,
    past_min_speed_kmh: past === null ? null : past - 5,
    past_max_speed_kmh: past === null ? null : past + 5,
    simulated: false,
    ...extra,
  }
}

function day(date: string, speeds: (number | null)[], over = 12, simulated = false): CityTrafficDay {
  const slots: CityTrafficSlot[] = DAY_SLOTS.map((t, s) => ({
    slot_start: `${date}T${t}:00+08:00`,
    detectors: speeds.map((v, i) => (s < over ? gw(i + 1, v, 50, { simulated }) : gw(i + 1, null, 50))),
    weather: null,
    simulated: s < over && simulated,
    weather_simulated: s < over,
  }))
  return { now: NOW, today: '2026-10-26', demo_clock: true, date, slots, simulated, weather_simulated: true }
}

describe('reading a gateway in a slot (DD-44, SC-C1)', () => {
  it('路況: the congestion level and its line width 4, 5, 7, 9px', () => {
    expect(readCell(gw(1, 50), 'data', 'level')).toMatchObject({ level: 1, widthPx: 4, dashed: false }) // 83%
    expect(readCell(gw(1, 40), 'data', 'level')).toMatchObject({ level: 2, widthPx: 5 }) // 67%
    expect(readCell(gw(1, 20), 'data', 'level')).toMatchObject({ level: 3, widthPx: 7 }) // 33%
    expect(readCell(gw(1, 10), 'data', 'level')).toMatchObject({ level: 4, widthPx: 9 }) // 17%
  })

  it('比平常: against the other days at the same time, widths 4, 4, 7, 9px; 差不多 is solid', () => {
    expect(readCell(gw(1, 60, 50), 'data', 'vs-usual')).toMatchObject({ level: 1, widthPx: 4, dashed: false })
    expect(readCell(gw(1, 50, 50), 'data', 'vs-usual')).toMatchObject({ level: 2, widthPx: 4, dashed: false })
    expect(readCell(gw(1, 40, 50), 'data', 'vs-usual')).toMatchObject({ level: 3, widthPx: 7 })
    expect(readCell(gw(1, 30, 50), 'data', 'vs-usual')).toMatchObject({ level: 4, widthPx: 9 })
  })

  it('no speed, or no other days to compare with in 比平常, is no data: a 3px dashed line', () => {
    expect(readCell(gw(1, null), 'data', 'level')).toMatchObject({ level: null, widthPx: 3, dashed: true })
    expect(readCell(gw(1, 50, null), 'data', 'vs-usual')).toMatchObject({ level: null, widthPx: 3, dashed: true })
    expect(readCell(gw(1, 50, null), 'data', 'level')).toMatchObject({ level: 1 })
  })

  it("today's slots not over yet: the usual speed in 路況, always 差不多 in 比平常", () => {
    expect(readCell(gw(1, null, 20), 'not-yet', 'level')).toMatchObject({ level: 3, dashed: false })
    expect(readCell(gw(1, null, 20), 'not-yet', 'vs-usual')).toMatchObject({ level: 2, widthPx: 4, dashed: false })
    expect(readCell(gw(1, null, null), 'not-yet', 'level')).toMatchObject({ level: null, dashed: true })
  })
})

describe('the gateway line on the map (UD-28)', () => {
  it('without a shape: 520 m along the bearing through the detector', () => {
    const path = gatewayPath(gw(1, 50))
    expect(path).toHaveLength(2)
    expect(path[0].lng).toBeLessThan(121.5) // E: from the west
    expect(path[1].lng).toBeGreaterThan(121.5)
  })

  it('with a shape: the shape around the detector, in its order', () => {
    const shape = Array.from({ length: 11 }, (_, i) => ({ lat: 25, lng: 121.5 + (i - 5) * 0.001 }))
    const path = gatewayPath(gw(1, 50, 50, { shape }))
    expect(path.length).toBeGreaterThan(2)
    expect(path.length).toBeLessThan(11) // about 320 m either side of ~100 m steps
    expect(path[0].lng).toBeLessThan(path[path.length - 1].lng)
  })
})

describe('the slowest three and the default gateway (SC-C1)', () => {
  it('the three lowest speed ratios, lowest first; no data is left out', () => {
    const slot = day('2026-10-22', [50, 10, null, 30, 20]).slots[4]
    expect(slowestThree(slot).map((g) => g.vd_id)).toEqual(['V2', 'V5', 'V4'])
  })

  it('opens on the gateway with the lowest speed ratio in the slot, by its own reference speed', () => {
    const slot = day('2026-10-22', [50, 30]).slots[4]
    const slower = { ...slot, detectors: [gw(1, 25, 50, { reference_speed_kmh: 30 }), gw(2, 30)] }
    expect(defaultGateway(slower)).toBe('V2') // 30/60 = 50% < 25/30 = 83%
    expect(defaultGateway({ ...slot, detectors: [gw(1, null), gw(2, null)] })).toBe('V1')
  })
})

describe('the source label (UD-28, REQ-063)', () => {
  it('a slot with measured data is TDX 實測, a simulated one 模擬; a slot without data says so', () => {
    expect(sourceOf(day('2026-10-22', [50]).slots[4], false)).toBe('TDX 實測')
    expect(sourceOf(day('2026-10-26', [50], 5, true).slots[4], false)).toBe('模擬')
    expect(sourceOf(day('2026-10-26', [50], 5, true).slots[8], true)).toBe('還沒到')
    // simulated is false both for measured data and for no data: only data says TDX 實測
    expect(sourceOf(day('2026-10-22', [null]).slots[4], false)).toBe('沒有資料')
  })
})

describe('the tooltip (SC-C1)', () => {
  it('name, date and slot, source, level, speed against the reference, the other days, occupancy and volume', () => {
    const g = gw(7, 20, 25, { proxy: true, proxy_note: '橋北端的新明路', gateway: '成美橋' })
    expect(tooltipLines(g, 'data', '2026-10-22', '08:00', 'TDX 實測')).toEqual([
      '7. 成美橋 *',
      '10/22 週四 08:00–08:15 · TDX 實測',
      '壅塞 · 20 km/h（參考速度 60 的 33%）',
      '其他天同時段平均 25 km/h，慢 20%',
      '佔有率 12% · 車流 120 輛／15 分',
      '代理值：偵測器在橋北端的新明路',
    ])
  })

  it('a slot with partial data adds a line on how volume was filled in', () => {
    const g = gw(1, 50, 40, { coverage_pct: 62.5 })
    expect(tooltipLines(g, 'data', '2026-10-22', '08:00', 'TDX 實測')).toContain('這格只收到 63% 的資料，車流量按比例補足')
    expect(tooltipLines(g, 'data', '2026-10-22', '08:00', 'TDX 實測')).toContain('其他天同時段平均 40 km/h，快 25%')
  })

  it('not over yet shows the usual speed; no data says so', () => {
    expect(tooltipLines(gw(1, null, 45), 'not-yet', '2026-10-26', '09:00', '還沒到')).toEqual(['1. 入口1', '10/26 週一 09:00–09:15 · 還沒到', '平常這時候 45 km/h · 順暢'])
    expect(tooltipLines(gw(1, null), 'data', '2026-10-22', '08:00', '沒有資料')).toEqual(['1. 入口1', '10/22 週四 08:00–08:15 · 沒有資料', '這個時段沒有資料'])
  })
})
