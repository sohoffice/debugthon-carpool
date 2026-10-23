import type { CityHistoryDay } from '@carpool/shared'
import { clockTime, monthDay, weekdayOf } from './format'

// The commute window holds 07:00-10:00 in 15-minute slots (DD-36): 07:00 .. 09:45.
const FIRST_SLOT_MIN = 7 * 60
const SLOT_COUNT = 12

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** Every slot start of a day, "07:00" .. "09:45". */
export const DAY_SLOTS: string[] = Array.from({ length: SLOT_COUNT }, (_, i) => hhmm(FIRST_SLOT_MIN + i * 15))

/** A slot picked on the traffic map; null means the latest slot, the default (DD-41). */
export interface SlotChoice {
  date: string
  time: string
}

/** "08:00" from the slot_start of a /api/city/traffic response. */
export function slotTime(slotStart: string): string {
  return clockTime(slotStart)
}

/** The slot query parameter: the slot's start in Taipei time, RFC 3339. */
export function slotParam(choice: SlotChoice): string {
  return `${choice.date}T${choice.time}:00+08:00`
}

/** Today's slots stop at the latest slot (ui-oi-22); a past day has all twelve. */
export function slotsOf(date: string, today: string, latestTime: string): string[] {
  return date === today ? DAY_SLOTS.filter((t) => t <= latestTime) : DAY_SLOTS
}

/** A new date keeps the time; when that day has no such slot, its last slot (SC-C1). */
export function changeDate(choice: SlotChoice, date: string, today: string, latestTime: string): SlotChoice {
  const slots = slotsOf(date, today, latestTime)
  return { date, time: slots.includes(choice.time) ? choice.time : slots[slots.length - 1] }
}

export interface DateOption {
  date: string
  label: string
}

/**
 * Today first, then the past 10 workdays, newest first, each with where its traffic comes from
 * (UD-28, REQ-063): "10/26 週一（今天 · 模擬）", "10/22 週四 · 實測". Today is always simulated (DD-36).
 */
export function dateOptions(today: string, days: CityHistoryDay[]): DateOption[] {
  const label = (date: string) => `${monthDay(date)} 週${weekdayOf(date)}`
  return [
    { date: today, label: `${label(today)}（今天 · 模擬）` },
    ...days.map((d) => ({ date: d.date, label: `${label(d.date)} · ${d.traffic_simulated ? '模擬' : '實測'}` })),
  ]
}
