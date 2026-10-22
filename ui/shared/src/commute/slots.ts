import type { WeatherObservation } from '../api/types'

// Commute window and slot helpers for the commute info screen (REQ-056, REQ-077, DD-38, DD-41).
// Times are minutes after midnight, Taipei time.

export const WINDOW_START = 7 * 60
export const WINDOW_END = 10 * 60
export const SLOT_MINUTES = 15
/** Slot starts 07:00-09:45: the 12 columns of both heat grids (UD-25). */
export const SLOT_STARTS = Array.from({ length: (WINDOW_END - WINDOW_START) / SLOT_MINUTES }, (_, i) => WINDOW_START + i * SLOT_MINUTES)

/** Off commute hours (only without the Demo clock), the window is 08:00-08:30 (DD-38). */
const OFF_HOURS_WINDOW = { from: 8 * 60, to: 8 * 60 + 30 }
const AROUND_NOW_MINUTES = 30
const TAIPEI_OFFSET_MINUTES = 8 * 60
const MINUTES_PER_DAY = 24 * 60
const WEEKDAYS = ['', '一', '二', '三', '四', '五', '六', '日']

/** From included, to not, like the backend's summary window. */
export interface SlotWindow {
  from: number
  to: number
}

/** Minutes after midnight in Taipei (no daylight saving) of an RFC 3339 time. */
export function taipeiMinutes(iso: string): number {
  const minutes = Math.floor(Date.parse(iso) / 60000) + TAIPEI_OFFSET_MINUTES
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

/** 465 → "07:45", the backend's HH:MM. */
export function formatMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const formatWindow = (w: SlotWindow) => `${formatMinutes(w.from)}–${formatMinutes(w.to)}`

/**
 * The default window from the Phase 2 now of /api/commute/weather, never the device clock (DD-41):
 * now ± 30 minutes, clamped to 07:00-10:00, from rounded down and to rounded up to 15 minutes;
 * 08:00-08:30 when now is outside 07:00-10:00 (DD-38). The Demo clock 08:15 gives 07:45-08:45.
 */
export function defaultWindow(nowIso: string): SlotWindow {
  const now = taipeiMinutes(nowIso)
  if (now < WINDOW_START || now >= WINDOW_END) return OFF_HOURS_WINDOW
  return {
    from: Math.max(WINDOW_START, Math.floor((now - AROUND_NOW_MINUTES) / SLOT_MINUTES) * SLOT_MINUTES),
    to: Math.min(WINDOW_END, Math.ceil((now + AROUND_NOW_MINUTES) / SLOT_MINUTES) * SLOT_MINUTES),
  }
}

/** The column of a slot start, or -1 outside the 12 commute slots. */
export function slotIndex(iso: string): number {
  return SLOT_STARTS.indexOf(taipeiMinutes(iso))
}

export const weekdayName = (isoWeekday: number) => WEEKDAYS[isoWeekday] ?? ''

/** "2026-10-23", 5 → "10/23 週五". */
export function dayLabel(date: string, isoWeekday: number): string {
  const [, month, day] = date.split('-').map(Number)
  return `${month}/${day} 週${weekdayName(isoWeekday)}`
}

/** ISO weekday (1 Monday .. 7 Sunday) of a YYYY-MM-DD date. */
export function isoWeekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7
}

/**
 * The day's weather: its rainiest slot, the first one when none rains (DD-38). Both grids use this
 * on the same per-slot weather, so a day shows the same weather on both (REQ-083).
 */
export function dayWeather(slots: (WeatherObservation | null)[]): WeatherObservation | null {
  return slots.reduce<WeatherObservation | null>((best, w) => (w && (!best || w.precipitation > best.precipitation) ? w : best), null)
}

export type WeatherKind = 'sun' | 'cloud' | 'rain'

/** The three icons of UD-25 for the CWA weather words (晴, 多雲, 陰, 陰有雨, ...). */
export function weatherKind(weather: string): WeatherKind {
  if (weather.includes('雨')) return 'rain'
  if (weather.includes('晴')) return 'sun'
  return 'cloud'
}

export const HEAT_LEVELS = 6

/** 0 rides is a blank cell (level 0); the rest spread over 1-6 by the grid's maximum. */
export function rideLevel(count: number, max: number): number {
  if (count <= 0) return 0
  if (max <= 0) return HEAT_LEVELS
  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil((count / max) * HEAT_LEVELS)))
}

/** Every observed traffic cell has a colour, 1-6 between the grid's minimum and maximum. */
export function trafficLevel(volume: number, min: number, max: number): number {
  if (max <= min) return Math.ceil(HEAT_LEVELS / 2)
  return 1 + Math.min(HEAT_LEVELS - 1, Math.floor(((volume - min) / (max - min)) * HEAT_LEVELS))
}
