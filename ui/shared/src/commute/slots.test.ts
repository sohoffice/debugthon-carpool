import { describe, expect, it } from 'vitest'
import type { WeatherObservation } from '../api/types'
import { dayLabel, dayWeather, defaultWindow, formatMinutes, rideLevel, slotIndex, taipeiMinutes, trafficLevel, weatherKind } from './slots'

const at = (hhmm: string) => `2026-10-26T${hhmm}:00+08:00`
const window = (hhmm: string) => {
  const w = defaultWindow(at(hhmm))
  return `${formatMinutes(w.from)}–${formatMinutes(w.to)}`
}
const obs = (weather: string, precipitation: number): WeatherObservation => ({
  station_id: 'C0A9F0',
  station_name: '內湖',
  obs_time: at('07:10'),
  weather,
  air_temperature: 18,
  precipitation,
})

describe('defaultWindow: now ± 30 minutes on 15-minute marks within 07:00-10:00 (DD-38, DD-41)', () => {
  it('is 07:45–08:45 at the Demo clock 08:15', () => {
    expect(window('08:15')).toBe('07:45–08:45')
  })

  it('rounds from down and to up to 15 minutes', () => {
    expect(window('08:20')).toBe('07:45–09:00')
    expect(window('08:00')).toBe('07:30–08:30')
  })

  it('clamps to the commute window at both edges', () => {
    expect(window('07:00')).toBe('07:00–07:30')
    expect(window('07:10')).toBe('07:00–07:45')
    expect(window('09:50')).toBe('09:15–10:00')
    expect(window('09:59')).toBe('09:15–10:00')
  })

  it('is 08:00–08:30 when now is outside commute hours, not a clamped edge window', () => {
    expect(window('06:50')).toBe('08:00–08:30')
    expect(window('06:59')).toBe('08:00–08:30')
    expect(window('10:00')).toBe('08:00–08:30')
    expect(window('15:30')).toBe('08:00–08:30')
  })

  it('reads now in Taipei time whatever the offset of the string', () => {
    expect(defaultWindow('2026-10-26T00:15:00Z')).toEqual(defaultWindow(at('08:15')))
  })
})

describe('slot helpers', () => {
  it('reads Taipei minutes and the slot index of a slot start', () => {
    expect(taipeiMinutes(at('07:45'))).toBe(465)
    expect(slotIndex(at('07:00'))).toBe(0)
    expect(slotIndex(at('09:45'))).toBe(11)
    expect(slotIndex(at('10:00'))).toBe(-1)
    expect(slotIndex(at('07:10'))).toBe(-1)
  })

  it('labels a day with its date and weekday', () => {
    expect(dayLabel('2026-10-23', 5)).toBe('10/23 週五')
    expect(dayLabel('2026-10-12', 1)).toBe('10/12 週一')
  })
})

describe('dayWeather: the slot with the most rain stands for the day (DD-38, UD-25)', () => {
  it('picks the rainiest slot', () => {
    expect(dayWeather([obs('陰', 0), obs('陰有雨', 1.2), obs('陰有雨', 3.4), obs('陰有雨', 0.8)])).toEqual(obs('陰有雨', 3.4))
  })

  it('takes the first slot when none rains, and skips slots not observed yet', () => {
    expect(dayWeather([null, obs('晴', 0), obs('多雲', 0)])).toEqual(obs('晴', 0))
    expect(dayWeather([null, null])).toBeNull()
    expect(dayWeather([])).toBeNull()
  })

  it('maps the CWA weather words to sun, cloud or rain', () => {
    expect(weatherKind('晴')).toBe('sun')
    expect(weatherKind('多雲')).toBe('cloud')
    expect(weatherKind('陰')).toBe('cloud')
    expect(weatherKind('陰有雨')).toBe('rain')
    expect(weatherKind('陰短暫雨')).toBe('rain')
  })
})

describe('heat levels', () => {
  it('leaves 0 rides blank and spreads the rest over levels 1-6 by the grid maximum', () => {
    expect(rideLevel(0, 10)).toBe(0)
    expect(rideLevel(1, 10)).toBe(1)
    expect(rideLevel(5, 10)).toBe(3)
    expect(rideLevel(10, 10)).toBe(6)
    expect(rideLevel(3, 0)).toBe(6)
  })

  it('spreads traffic over levels 1-6 between the grid minimum and maximum', () => {
    expect(trafficLevel(100, 100, 700)).toBe(1)
    expect(trafficLevel(400, 100, 700)).toBe(4)
    expect(trafficLevel(700, 100, 700)).toBe(6)
    expect(trafficLevel(500, 500, 500)).toBe(3)
  })
})
