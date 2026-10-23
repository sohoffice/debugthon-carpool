import { describe, expect, it } from 'vitest'
import { changeDate, DAY_SLOTS, dateOptions, slotParam, slotsOf, slotTime } from './trafficSlots'

const TODAY = '2026-10-26'

describe('traffic slot picker (ui-oi-22, SC-C1)', () => {
  it('has twelve 15-minute slots from 07:00 to 09:45', () => {
    expect(DAY_SLOTS).toHaveLength(12)
    expect(DAY_SLOTS[0]).toBe('07:00')
    expect(DAY_SLOTS[11]).toBe('09:45')
  })

  it('lists today only up to the latest slot, a past day in full', () => {
    expect(slotsOf(TODAY, TODAY, '08:00')).toEqual(['07:00', '07:15', '07:30', '07:45', '08:00'])
    expect(slotsOf('2026-10-23', TODAY, '08:00')).toHaveLength(12)
  })

  it('keeps the time when the new date has it, else takes the last slot of that day', () => {
    expect(changeDate({ date: TODAY, time: '07:30' }, '2026-10-23', TODAY, '08:00')).toEqual({ date: '2026-10-23', time: '07:30' })
    expect(changeDate({ date: '2026-10-23', time: '09:30' }, TODAY, TODAY, '08:00')).toEqual({ date: TODAY, time: '08:00' })
    expect(changeDate({ date: '2026-10-23', time: '08:00' }, TODAY, TODAY, '08:00')).toEqual({ date: TODAY, time: '08:00' })
  })

  it("puts today first, then the past days newest first, with the weekday and the day's traffic source (UD-28)", () => {
    const days = [
      { date: '2026-10-23', weekday: 5, rides: 0, weather: null, simulated: true, traffic_simulated: true },
      { date: '2026-10-22', weekday: 4, rides: 0, weather: null, simulated: true, traffic_simulated: false },
    ]
    expect(dateOptions(TODAY, days).map((o) => o.label)).toEqual(['10/26 週一（今天 · 模擬）', '10/23 週五 · 模擬', '10/22 週四 · 實測'])
  })

  it('asks for the slot by its Taipei start time and reads it back the same way', () => {
    expect(slotParam({ date: '2026-10-23', time: '08:00' })).toBe('2026-10-23T08:00:00+08:00')
    expect(slotTime('2026-10-23T00:00:00Z')).toBe('08:00')
  })
})
