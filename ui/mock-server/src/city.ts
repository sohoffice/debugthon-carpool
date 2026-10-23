import type {
  CityClock,
  CityGateway,
  CityHistory,
  CityHistoryDay,
  CityLive,
  CityLiveCounts,
  CityToday,
  CityTraffic,
  CityTrafficDay,
  CityTrafficSlot,
  CityVehicle,
  PickupPoint,
} from '../../shared/src/api/types.ts'
import { commuteMoment, pastWorkdays, type createCommute } from './commute.ts'
import type { Lookups } from './context.ts'
import type { CsvGateway } from './data/load.ts'
import { MockError } from './errors.ts'
import { makePath, pointAlong, type LatLng, type Path } from './geo.ts'
import { alongAt, type World } from './world.ts'

// City dashboard for the mock backend (DD-39, DD-40, DD-41): the same shapes as the Go backend's
// /api/city/*, with simpler made-up numbers. The mock always behaves as if demo_clock were set:
// now is today at 08:15, and a weekend today becomes the next Monday. Weather and the pickup
// statistics come from the commute mock, so the dashboard and the commute info agree (REQ-083).

const DEMO_CLOCK_MIN = 8 * 60 + 15
const SLOT_MIN = 15
const FIRST_SLOT_MIN = 7 * 60
const LAST_SLOT_MIN = 9 * 60 + 45

/** Where the simulated cars go in the park. */
const PARK_DESTINATIONS: LatLng[] = [
  { lat: 25.079, lng: 121.573 },
  { lat: 25.0785, lng: 121.5795 },
  { lat: 25.0815, lng: 121.5855 },
]

// The live round, like the Go backend (DD-40 step 5): 30-40 cars departing over 15 minutes, the
// round shifted 14 minutes back so the first look already shows the peak.
const ROUND_OFFSET_MS = -14 * 60_000
const DEPARTURE_SPREAD_MS = 15 * 60_000

/** Deterministic 0..1 from a string (FNV-1a), so the same day gives the same numbers (DD-40). */
function rand(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
/** RFC 3339 in Taipei time, as the Go backend writes times (+08:00). */
const taipeiIso = (date: string, min: number) => `${date}T${hhmm(min)}:00+08:00`
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()
/** A morning peak around 08:30. */
const peak = (min: number) => 0.35 + 0.65 * Math.exp(-(((min - 510) / 50) ** 2))
const friday = (date: string) => (weekdayOf(date) === 5 ? 1.15 : 1)

/**
 * One gateway's made-up traffic in a slot: volume follows the morning peak, the speed drops from the
 * gateway's reference speed (DD-44) as the load grows. Everything is simulated in the mock.
 */
function observation(g: CsvGateway, date: string, min: number, raining: boolean) {
  const load = peak(min) * friday(date) * (raining ? 1.1 : 1) * (0.9 + rand(`vol:${g.vd_id}:${date}:${min}`) * 0.2)
  const volume = Math.round((g.source === 'freeway' ? 300 : 450) * load)
  const speed = Math.round(g.reference_speed_kmh * (1.05 - 0.6 * Math.min(load, 1.2)) * (raining ? 0.9 : 1) * 10) / 10
  const occupancy = Math.round(Math.min(95, 4 + 30 * load) * 10) / 10
  return { volume, speed, occupancy }
}

interface SimCar {
  pickupName: string
  path: Path
  pickupAlong: number
  departMs: number
  speedMps: number
  passengers: { showMs: number; matchMs: number }[]
}

export function createCity(lookups: Lookups, commute: ReturnType<typeof createCommute>, gateways: CsvGateway[]) {
  const pickups: PickupPoint[] = [...lookups.pickupById.values()]
  const place = (p: PickupPoint) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })
  let roundStartMs: number | null = null

  const clockOf = (nowMs: number): CityClock => {
    const { today, now } = commuteMoment(nowMs)
    return { now, today, demo_clock: true }
  }
  const commuteToday = (nowMs: number) => commuteMoment(nowMs).today
  const rainingAt = (date: string, min: number) => commute.weatherCells(date).find((c) => c.slot === (min - FIRST_SLOT_MIN) / SLOT_MIN)?.raining ?? false
  const statsOf = (pickupId: number, date: string) => commute.slotStats(pickupId, date)
  /** The latest slot: the last complete one before now, 08:00 in the Demo (DD-41). */
  const LATEST_SLOT_MIN = DEMO_CLOCK_MIN - SLOT_MIN

  /** The round's cars, planned from today's date; departures relative to the round start. */
  function plan(today: string, startMs: number): SimCar[] {
    const n = 30 + Math.floor(rand(`cars:${today}`) * 11)
    return Array.from({ length: n }, (_, i) => {
      const pickup = pickups[i % pickups.length]
      const angle = rand(`dir:${today}:${i}`) * 2 * Math.PI
      const km = 1 + rand(`far:${today}:${i}`) * 1.5
      const start = { lat: pickup.lat + (Math.sin(angle) * km) / 111, lng: pickup.lng + (Math.cos(angle) * km) / 101 }
      const toPickup = makePath([start, pickup])
      const path = makePath([start, pickup, PARK_DESTINATIONS[i % PARK_DESTINATIONS.length]])
      const departMs = startMs + ROUND_OFFSET_MS + (DEPARTURE_SPREAD_MS * i) / n
      const speedMps = (15 + rand(`kmh:${today}:${i}`) * 7) / 3.6
      const atPickupMs = departMs + (toPickup.length / speedMps) * 1000
      const passengers = Array.from({ length: 1 + Math.floor(rand(`pax:${today}:${i}`) * 3) }, (_, j) => {
        const showMs = atPickupMs - (3 + rand(`lead:${today}:${i}:${j}`) * 5) * 60_000
        return { showMs, matchMs: Math.max(showMs, departMs) + 30_000 }
      })
      return { pickupName: pickup.name, path, pickupAlong: toPickup.length, departMs, speedMps, passengers }
    })
  }

  /** Passengers of the round's cars that have arrived, by pickup point name. */
  function arrivedByPickup(nowMs: number): Map<string, number> {
    const out = new Map<string, number>()
    if (roundStartMs === null) return out
    for (const car of plan(commuteToday(nowMs), roundStartMs)) {
      if ((nowMs - car.departMs) / 1000 * car.speedMps >= car.path.length) {
        out.set(car.pickupName, (out.get(car.pickupName) ?? 0) + car.passengers.length)
      }
    }
    return out
  }

  function live(world: World, nowMs: number): CityLive {
    roundStartMs ??= nowMs
    const vehicles: CityVehicle[] = []
    const real: CityLiveCounts = { vehicles: 0, on_board: 0, waiting: 0, matched: 0 }
    const sim: CityLiveCounts = { vehicles: 0, on_board: 0, waiting: 0, matched: 0 }
    const waitingAt = new Map<number, number>()
    const simWaitingAt = new Map<string, number>()

    for (const trip of world.trips.filter((t) => t.status === 'active')) {
      const { position, heading } = pointAlong(trip.path, alongAt(trip, nowMs))
      const onBoard = world.requests.filter((r) => r.status === 'boarded' && r.candidates[r.candidateIndex]?.tripId === trip.id).length
      vehicles.push({ ...position, heading_deg: heading, on_board: onBoard, simulated: false })
      real.vehicles++
    }
    for (const r of world.requests) {
      if (r.status === 'waiting_driver') {
        real.waiting++
        waitingAt.set(r.pickupPointId, (waitingAt.get(r.pickupPointId) ?? 0) + 1)
      }
      if (r.status === 'confirmed') real.matched++
      if (r.status === 'boarded') real.on_board++
    }

    for (const car of plan(commuteToday(nowMs), roundStartMs)) {
      const along = ((nowMs - car.departMs) / 1000) * car.speedMps
      if (along >= car.path.length) continue
      if (along >= 0) {
        const { position, heading } = pointAlong(car.path, along)
        const onBoard = along >= car.pickupAlong ? car.passengers.length : 0
        vehicles.push({ ...position, heading_deg: heading, on_board: onBoard, simulated: true })
        sim.vehicles++
        sim.on_board += onBoard
        if (onBoard > 0) continue
      }
      for (const p of car.passengers) {
        if (nowMs < p.showMs) continue
        if (nowMs < p.matchMs) {
          sim.waiting++
          simWaitingAt.set(car.pickupName, (simWaitingAt.get(car.pickupName) ?? 0) + 1)
        } else sim.matched++
      }
    }

    const sum = (a: CityLiveCounts, b: CityLiveCounts): CityLiveCounts => ({
      vehicles: a.vehicles + b.vehicles,
      on_board: a.on_board + b.on_board,
      waiting: a.waiting + b.waiting,
      matched: a.matched + b.matched,
    })
    return {
      ...clockOf(nowMs),
      vehicles,
      counts: sum(real, sim),
      simulated_counts: sim,
      pickup_points: pickups.map((p) => {
        const s = simWaitingAt.get(p.name) ?? 0
        return { ...place(p), waiting: (waitingAt.get(p.id) ?? 0) + s, simulated_waiting: s }
      }),
      simulated: sim.vehicles + sim.on_board + sim.waiting + sim.matched > 0,
    }
  }

  /** Days with traffic: today and the past 10 workdays (DD-41). */
  const knownDay = (today: string, date: string) => date === today || pastWorkdays(today).includes(date)

  /** One slot with the 16 gateways, each next to the past 10 workdays at the same time, its own day left out (4.20). */
  function slotOf(today: string, date: string, min: number): CityTrafficSlot {
    const past = pastWorkdays(today).filter((day) => day !== date)
    const weather = commute.weatherCells(date).find((c) => c.slot === (min - FIRST_SLOT_MIN) / SLOT_MIN)?.weather ?? null
    const detectors: CityGateway[] = gateways.map((g) => {
      const o = observation(g, date, min, rainingAt(date, min))
      const pastSpeeds = past.map((day) => observation(g, day, min, rainingAt(day, min)).speed)
      return {
        ...g,
        volume: o.volume,
        avg_speed_kmh: o.speed,
        occupancy_pct: o.occupancy,
        coverage_pct: 100,
        past_avg_speed_kmh: Math.round((pastSpeeds.reduce((a, b) => a + b, 0) / pastSpeeds.length) * 10) / 10,
        past_min_speed_kmh: Math.min(...pastSpeeds),
        past_max_speed_kmh: Math.max(...pastSpeeds),
        simulated: true,
      }
    })
    return { slot_start: taipeiIso(date, min), detectors, weather, simulated: true, weather_simulated: true }
  }

  function traffic(nowMs: number, rawSlot: string | null): CityTraffic {
    const clock = clockOf(nowMs)
    let date = clock.today
    let min = LATEST_SLOT_MIN
    if (rawSlot) {
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):00(?:\+08:00)$/.exec(rawSlot)
      if (!m || Number(m[3]) % SLOT_MIN !== 0) {
        throw new MockError(400, 'invalid_request', 'slot 須為 15 分鐘時段的開始時間（RFC 3339，例如 2026-10-23T08:00:00+08:00）')
      }
      date = m[1]
      min = Number(m[2]) * 60 + Number(m[3])
    }
    const known = date === clock.today ? min <= LATEST_SLOT_MIN : knownDay(clock.today, date)
    if (!known || min < FIRST_SLOT_MIN || min > LAST_SLOT_MIN) throw new MockError(404, 'not_found', '這個時段沒有車流資料')
    return { ...clock, ...slotOf(clock.today, date, min) }
  }

  /** ?date=: the day's 12 slots, today's through the latest slot (DD-39). */
  function trafficDay(nowMs: number, rawDate: string): CityTrafficDay {
    const clock = clockOf(nowMs)
    const parsed = new Date(`${rawDate}T00:00:00Z`)
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === rawDate
    if (!valid) throw new MockError(400, 'invalid_request', 'date 須為日期（YYYY-MM-DD，例如 2026-10-22）')
    if (!knownDay(clock.today, rawDate)) throw new MockError(404, 'not_found', '這一天沒有車流資料')
    const last = rawDate === clock.today ? LATEST_SLOT_MIN : LAST_SLOT_MIN
    const slots: CityTrafficSlot[] = []
    for (let min = FIRST_SLOT_MIN; min <= last; min += SLOT_MIN) slots.push(slotOf(clock.today, rawDate, min))
    return { ...clock, date: rawDate, slots, simulated: true, weather_simulated: true }
  }

  function today(world: World, nowMs: number): CityToday {
    const clock = clockOf(nowMs)
    const arrived = arrivedByPickup(nowMs)
    let requests = 0
    let matched = 0
    let noMatch = 0
    let completed = 0
    const byPickup = pickups.map((p) => {
      // Simulated slots before now (DD-40 step 4): every match counts as a ride.
      const sim = statsOf(p.id, clock.today)
      const simPassengers = sim.reduce((n, s) => n + s.passengers, 0)
      const simRides = sim.reduce((n, s) => n + s.rides, 0)
      const real = world.requests.filter((r) => r.pickupPointId === p.id)
      const realSent = real.filter((r) => r.status !== 'rejected').length
      const realMatched = real.filter((r) => ['confirmed', 'boarded', 'completed'].includes(r.status)).length
      const realNoMatch = real.filter((r) => r.status === 'no_match').length
      const realCompleted = real.filter((r) => r.status === 'completed').length
      const a = arrived.get(p.name) ?? 0
      requests += simPassengers + realSent + a
      matched += simRides + realMatched + a
      noMatch += simPassengers - simRides + realNoMatch
      const done = simRides + realCompleted + a
      completed += done
      return { ...place(p), completed: done }
    })
    return {
      ...clock,
      completed,
      requests,
      matched,
      match_rate: requests > 0 ? matched / requests : null,
      no_match: noMatch,
      trips_saved: completed,
      trips_saved_estimate: true,
      pickup_points: byPickup,
      simulated: true,
    }
  }

  function history(nowMs: number): CityHistory {
    const clock = clockOf(nowMs)
    const daysBack = pastWorkdays(clock.today)
    const days: CityHistoryDay[] = daysBack.map((date) => {
      const rides = pickups.reduce((n, p) => n + statsOf(p.id, date).reduce((m, s) => m + s.rides, 0), 0)
      // The day's weather is its rainiest slot (DD-38), the same copy as /api/commute/traffic.
      const weather = commute.weatherCells(date).map((c) => c.weather).reduce((a, b) => (b.precipitation > a.precipitation ? b : a))
      return { date, weekday: weekdayOf(date), rides, weather, simulated: true }
    })
    const perDay = (n: number) => Math.round((n / daysBack.length) * 10) / 10
    return {
      ...clock,
      days,
      pickup_points: pickups.map((p) => {
        const all = daysBack.flatMap((date) => statsOf(p.id, date))
        return {
          ...place(p),
          drivers_per_day: perDay(all.reduce((n, s) => n + s.drivers, 0)),
          passengers_per_day: perDay(all.reduce((n, s) => n + s.passengers, 0)),
          rides_per_day: perDay(all.reduce((n, s) => n + s.rides, 0)),
        }
      }),
      simulated: true,
    }
  }

  return {
    live,
    traffic,
    trafficDay,
    today,
    history,
    /** A Demo reset starts a new live round at the next dashboard query (DD-40 step 5). */
    resetRound: () => {
      roundStartMs = null
    },
  }
}
