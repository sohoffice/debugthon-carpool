import type {
  CommuteTraffic,
  CommuteWeather,
  PickupRides,
  RideDay,
  RideSlot,
  RideSummary,
  TrafficDay,
  WeatherObservation,
} from '../../shared/src/api/types.ts'
import { MockError } from './errors.ts'

// Commute info (Phase 2, REQ-056, REQ-077, DD-38, DD-40, DD-41), shaped like the Go backend's
// /api/commute/*. The mock always runs on the seeded Demo clock 08:15 (demo_clock = 495).
// Like generate_commute_simulation: one weather per slot, traffic and rides follow it, and the
// random numbers are seeded by today's date, so a day gives the same data every time.

const DEMO_CLOCK_MIN = 8 * 60 + 15
const PAST_WORKDAYS = 10
const SLOT_MIN = 15
const WINDOW_START = 7 * 60
const WINDOW_END = 10 * 60
const SLOTS = (WINDOW_END - WINDOW_START) / SLOT_MIN
const PEAK_SLOT = 5 // 08:15
const DAY_MS = 24 * 3600 * 1000
const TAIPEI_MS = 8 * 3600 * 1000
const DETECTORS = 12
const AVG_SEATS = 2

interface Moment {
  /** YYYY-MM-DD, Taipei. */
  today: string
  now: string
  /** Slots of today before now are observed; the one holding now is not yet (DD-40 step 4). */
  nowSlot: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const isoWeekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
const at = (date: string, minutes: number) => `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00+08:00`

/** The Phase 2 now (DD-41): today at 08:15; Saturday and Sunday move to the next Monday. */
export function commuteMoment(realNowMs: number): Moment {
  let today = new Date(realNowMs + TAIPEI_MS).toISOString().slice(0, 10)
  while (isoWeekday(today) > 5) today = addDays(today, 1)
  return { today, now: at(today, DEMO_CLOCK_MIN), nowSlot: (DEMO_CLOCK_MIN - WINDOW_START) / SLOT_MIN }
}

/** The 10 workdays before today, newest first (no public holidays, like the backend). */
export function pastWorkdays(today: string): string[] {
  const days: string[] = []
  for (let d = addDays(today, -1); days.length < PAST_WORKDAYS; d = addDays(d, -1)) if (isoWeekday(d) <= 5) days.push(d)
  return days
}

/** A number in [0, 1) from today and a key: FNV-1a, then one mulberry32 step. */
function random(today: string, key: string): number {
  let h = 2166136261
  for (const ch of `${today}/${key}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  let t = (h + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export interface Cell {
  slot: number
  weather: WeatherObservation
  raining: boolean
}

/** Every observed slot of a day: 2 or 3 of the past days rain from one of the first slots on (DD-40 step 1). */
function weatherOf(today: string, date: string, rainyDays: Set<string>): Cell[] {
  const rainy = rainyDays.has(date) || (date === today && random(today, `rain/${date}`) < 0.25)
  const rainFrom = Math.floor(random(today, `rain-start/${date}`) * 4)
  const sunny = random(today, `sky/${date}`) < 0.5
  const last = date === today ? (DEMO_CLOCK_MIN - WINDOW_START) / SLOT_MIN : SLOTS
  return Array.from({ length: last }, (_, slot) => {
    const raining = rainy && slot >= rainFrom
    const minutes = WINDOW_START + slot * SLOT_MIN
    return {
      slot,
      raining,
      weather: {
        station_id: 'C0A9F0',
        station_name: '內湖',
        obs_time: at(date, minutes + 10),
        weather: raining ? '陰有雨' : rainy ? '陰' : sunny ? '晴' : '多雲',
        air_temperature: Math.round((18 + random(today, `temp/${date}`) * 6 + slot * 0.15 - (raining ? 2 : 0)) * 10) / 10,
        precipitation: raining ? Math.round((0.5 + random(today, `mm/${date}/${slot}`) * 3.5) * 10) / 10 : 0,
      },
    }
  })
}

const peak = (slot: number, low: number, width: number) => low + (1 - low) * Math.exp(-((slot - PEAK_SLOT) ** 2) / width)

export function createCommute(realNow: () => number) {
  function world() {
    const m = commuteMoment(realNow())
    const days = pastWorkdays(m.today)
    const order = [...days].sort((a, b) => random(m.today, `rain/${a}`) - random(m.today, `rain/${b}`))
    const rainyDays = new Set(order.slice(0, 2 + (random(m.today, 'rain-days') < 0.5 ? 1 : 0)))
    const cells = (date: string) => weatherOf(m.today, date, rainyDays)
    return { m, days, cells }
  }

  function traffic(): CommuteTraffic {
    const { m, days, cells } = world()
    const out: TrafficDay[] = days.map((date) => {
      const dow = isoWeekday(date) === 5 ? 1.15 : isoWeekday(date) === 1 ? 1.02 : 1
      return {
        date,
        weekday: isoWeekday(date),
        slots: cells(date).map(({ slot, weather, raining }) => {
          const shape = peak(slot, 0.55, 8)
          const noise = 0.92 + random(m.today, `volume/${date}/${slot}`) * 0.16
          const volume = Math.round(DETECTORS * 260 * shape * dow * (raining ? 1.1 : 1) * noise)
          const speed = 60 * (1 - (0.45 * (shape - 0.55)) / 0.45) * (dow > 1.1 ? 0.92 : 1) * (raining ? 0.75 : 1)
          return { slot_start: at(date, WINDOW_START + slot * SLOT_MIN), volume, avg_speed_kmh: Math.round(speed * 10) / 10, weather, simulated: true }
        }),
      }
    })
    return { now: m.now, today: m.today, days: out, simulated: true }
  }

  function weather(): CommuteWeather {
    const { m, cells } = world()
    const latest = cells(m.today).at(-1)?.weather ?? null
    return { now: m.now, today: m.today, weather: latest, simulated: latest !== null }
  }

  /** One pickup point's simulated drivers, passengers and rides per observed slot of a day (DD-37, DD-40 step 3). */
  function slotStats(pickupPointId: number, date: string) {
    const { m, cells } = world()
    return cells(date).map(({ slot, weather, raining }) => {
      const dow = isoWeekday(date) === 5 ? 1.3 : isoWeekday(date) === 1 ? 1.05 : 1
      const key = `${pickupPointId}/${date}/${slot}`
      const shape = peak(slot, 0.45, 6) * dow
      const passengers = Math.round((4 + random(m.today, `passengers/${pickupPointId}`) * 4) * shape * (raining ? 1.3 : 1) * (0.85 + random(m.today, `p/${key}`) * 0.3))
      const drivers = Math.round((2 + random(m.today, `drivers/${pickupPointId}`) * 2) * shape * (raining ? 1.1 : 1) * (0.85 + random(m.today, `d/${key}`) * 0.3))
      const rides = Math.min(passengers, drivers * AVG_SEATS, Math.round(passengers * (0.65 + random(m.today, `match/${key}`) * 0.3)))
      return { slot, weather, raining, passengers, drivers, rides }
    })
  }

  /** Every observed slot's weather of a day, the same copy the traffic and rides use (REQ-083). */
  function weatherCells(date: string): Cell[] {
    return world().cells(date)
  }

  /** `realRides` is today's completed rides at the pickup point: all in the slot holding now (DD-41). */
  function pickupRides(pickupPointId: number, query: URLSearchParams, realRides: number): PickupRides {
    const window = slotWindow(query.get('from'), query.get('to'))
    const { m, days } = world()
    const ridesOf = (date: string): RideSlot[] =>
      slotStats(pickupPointId, date).map(({ slot, rides, weather }) => ({
        slot_start: at(date, WINDOW_START + slot * SLOT_MIN),
        ride_count: rides,
        weather,
        simulated: true,
      }))
    const past: RideDay[] = days.map((date) => ({ date, weekday: isoWeekday(date), slots: ridesOf(date) }))
    const nowSlot: RideSlot = { slot_start: at(m.today, WINDOW_START + m.nowSlot * SLOT_MIN), ride_count: realRides, weather: null, simulated: false }
    const today: RideDay = { date: m.today, weekday: isoWeekday(m.today), slots: [...ridesOf(m.today), nowSlot] }
    return {
      now: m.now,
      pickup_point_id: pickupPointId,
      days: past,
      today,
      summary: summarize(past, today.weekday, window, query.get('from')!, query.get('to')!),
      simulated: true,
    }
  }

  return { traffic, weather, pickupRides, slotStats, weatherCells }
}

function slotMinutes(s: string | null): number | null {
  const match = s === null ? null : /^(\d\d):(\d\d)$/.exec(s)
  if (!match) return null
  const m = Number(match[1]) * 60 + Number(match[2])
  return Number(match[2]) < 60 && m % SLOT_MIN === 0 && m >= WINDOW_START && m <= WINDOW_END ? m : null
}

/** Like the backend's parseSlotWindow: HH:MM on 15-minute marks, 07:00 <= from < to <= 10:00. */
function slotWindow(from: string | null, to: string | null) {
  const f = slotMinutes(from)
  const t = slotMinutes(to)
  if (f === null || t === null || f >= t) {
    throw new MockError(400, 'invalid_request', 'from、to 須為 07:00～10:00 之間以 15 分鐘為單位的時間（HH:MM），且 from 早於 to')
  }
  return { from: f, to: t }
}

/** Rides in from-to per day, over all days and over today's weekday's (REQ-056), like summarizeRides. */
function summarize(days: RideDay[], weekday: number, window: { from: number; to: number }, from: string, to: string): RideSummary {
  const inWindow = (d: RideDay) =>
    d.slots.filter((s) => {
      const m = Number(s.slot_start.slice(11, 13)) * 60 + Number(s.slot_start.slice(14, 16))
      return m >= window.from && m < window.to
    }).reduce((n, s) => n + s.ride_count, 0)
  const totals = days.map(inWindow)
  const same = days.flatMap((d, i) => (d.weekday === weekday ? [totals[i]] : []))
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  return {
    from,
    to,
    daily_avg: days.length ? sum(totals) / days.length : 0,
    weekday,
    same_weekday_avg: same.length ? sum(same) / same.length : null,
  }
}
