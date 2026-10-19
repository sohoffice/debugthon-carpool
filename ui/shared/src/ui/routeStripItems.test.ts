import { describe, expect, it } from 'vitest'
import type { BusStop } from '../api/types'
import { routeStripItems } from './routeStripItems'

const stop = (id: number, name: string): BusStop => ({ id, stop_id: id, name, lat: 0, lng: 0 })
const names = (r: ReturnType<typeof routeStripItems>) => r.items.map((i) => i.name)

describe('routeStripItems', () => {
  it('shows every stop of a short route, merging both sides of a road', () => {
    const r = routeStripItems('松山車站', [stop(1, '堤頂大道一段'), stop(2, '陽光街'), stop(3, '陽光街')], '瑞光路 513 巷')
    expect(names(r)).toEqual(['松山車站', '堤頂大道一段', '陽光街', '瑞光路 513 巷'])
    expect(r.hidden).toBe(0)
  })

  it('shows a name once even when its stops are not next to each other', () => {
    const r = routeStripItems('松山車站', [stop(1, '麥帥一橋'), stop(2, '行善路'), stop(3, '麥帥一橋'), stop(4, '陽光街')], '終點', { maxStops: 2 })
    expect(new Set(names(r)).size).toBe(names(r).length)
    expect(r.hidden).toBe(1)
  })

  it('keeps a long route short but never drops the passenger’s stop', () => {
    const stops = Array.from({ length: 10 }, (_, i) => stop(i + 1, `站${i + 1}`))
    const r = routeStripItems('松山車站', stops, '終點', { dropoffStopId: 10, maxStops: 3 })
    expect(r.items).toHaveLength(5)
    expect(r.items.find((i) => i.kind === 'dropoff')?.name).toBe('站10')
    expect(r.hidden).toBe(7)
  })
})
