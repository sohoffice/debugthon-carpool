import type { CityGateway, CityTrafficDay, CityTrafficSlot } from '@carpool/shared'
import { describe, expect, it } from 'vitest'
import { gridRows, latestIndex, shortGateway, slowestRun } from './gatewayRows'
import { DAY_SLOTS } from './trafficSlots'

const NOW = '2026-10-26T08:15:00+08:00'

function gw(order: number, speed: number | null, past = 50, reference = 60): CityGateway {
  return {
    vd_id: `V${order}`,
    source: order > 10 ? 'freeway' : 'city',
    gateway: `入口${order}`,
    road_name: '',
    road_direction: 'N',
    bearing: 'N',
    sort_order: order,
    location_note: '區界外',
    lat: 25,
    lng: 121,
    shape: null,
    proxy: false,
    proxy_note: null,
    reference_speed_kmh: reference,
    volume: speed === null ? null : 100,
    avg_speed_kmh: speed,
    occupancy_pct: speed === null ? null : 5,
    coverage_pct: speed === null ? null : 100,
    past_avg_speed_kmh: past,
    past_min_speed_kmh: past - 5,
    past_max_speed_kmh: past + 5,
    simulated: speed !== null,
  }
}

/** Today at 08:15: 07:00-08:00 have traffic, 08:15 on only the past speeds (4.18). */
function today(speedOf: (order: number, slot: number) => number | null): CityTrafficDay {
  const slots: CityTrafficSlot[] = DAY_SLOTS.map((t, s) => {
    const over = s <= 4
    return {
      slot_start: `2026-10-26T${t}:00+08:00`,
      detectors: [1, 2].map((o) => gw(o, over ? speedOf(o, s) : null)),
      weather: null,
      simulated: over,
      weather_simulated: over,
    }
  })
  return { now: NOW, today: '2026-10-26', demo_clock: true, date: '2026-10-26', slots, simulated: true, weather_simulated: true }
}

describe('gateway × slot grid (REQ-079, SC-C1)', () => {
  it('short row names: 國1 + interchange + direction, brackets dropped', () => {
    expect(shortGateway('國道1號高架 堤頂交流道（北向出口）')).toBe('國1 堤頂 北向出口')
    expect(shortGateway('國道1號 內湖交流道（南向出口，往環東大道）')).toBe('國1 內湖 南向往環東大道')
    expect(shortGateway('堤頂大道（大直端）')).toBe('堤頂大道 大直端')
    expect(shortGateway('民權大橋')).toBe('民權大橋')
  })

  it('one row per gateway, 12 cells; slots not over by now are 還沒到, coloured by the past average', () => {
    const rows = gridRows(today(() => 50))
    expect(rows.map((r) => r.gateway.gateway)).toEqual(['入口1', '入口2'])
    expect(rows[0].cells).toHaveLength(12)
    expect(rows[0].cells.map((c) => c.kind)).toEqual([...Array(5).fill('data'), ...Array(7).fill('not-yet')])
    // 50 / 60 = 83%: 順暢, for today's data and the past average alike.
    expect(rows[0].cells[0]).toMatchObject({ time: '07:00', level: 1, speed: 50 })
    expect(rows[0].cells[5]).toMatchObject({ time: '08:15', kind: 'not-yet', level: 1, speed: 50 })
    expect(rows[0].cells[5].label).toContain('還沒到')
  })

  it('a slot that is over without a speed is no data, not 還沒到', () => {
    const rows = gridRows(today((o, s) => (o === 2 && s === 3 ? null : 50)))
    expect(rows[1].cells[3]).toMatchObject({ kind: 'none', level: null })
    expect(rows[1].cells[3].label).toContain('沒有資料')
  })

  it('the latest slot is the last one over by now', () => {
    expect(latestIndex(today(() => 50))).toBe(4)
  })

  it('the headline names the slowest gateway and the run of slots near its worst level', () => {
    // 入口2: 07:15-07:45 at 12-17 km/h (嚴重 / 壅塞), elsewhere 50.
    const day = today((o, s) => (o === 2 && s >= 1 && s <= 3 ? (s === 2 ? 12 : 17) : 50))
    expect(slowestRun(gridRows(day))).toBe('入口2 07:15–08:00 最慢')
  })

  it('the headline only looks at slots that are over: 還沒到 is the past average, not today', () => {
    // 入口1 slow all day, including the past average after 08:00.
    const day = today(() => 20)
    day.slots = day.slots.map((s, i) => (i <= 4 ? s : { ...s, detectors: s.detectors.map((g) => ({ ...g, past_avg_speed_kmh: 10 })) }))
    expect(slowestRun(gridRows(day))).toBe('入口1 07:00–08:15 最慢')
  })

  it('the headline says all is smooth when no gateway is below 順暢, and waits for data', () => {
    expect(slowestRun(gridRows(today(() => 55)))).toBe('今天各入口都順暢')
    expect(slowestRun(gridRows(today(() => null)))).toBe('今天還沒有車流資料')
  })
})
