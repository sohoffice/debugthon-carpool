import type { RideDay, TrafficDay, TrafficSlot } from '../api/types'
import type { HeatCell, HeatRow } from './HeatGrid'
import { dayLabel, dayWeather, formatMinutes, rideLevel, SLOT_MINUTES, SLOT_STARTS, slotIndex, taipeiMinutes, trafficLevel, weatherKind } from './slots'

// Rows of the two heat grids from the API (UD-25). Both take a row's weather from its own slots
// with dayWeather; the slots carry the same per-slot weather (REQ-083), so a day reads the same.

const slotRange = (iso: string) => {
  const m = taipeiMinutes(iso)
  return `${formatMinutes(m)}–${formatMinutes(m + SLOT_MINUTES)}`
}

function place<T extends { slot_start: string }>(slots: T[]): (T | null)[] {
  const cells: (T | null)[] = SLOT_STARTS.map(() => null)
  for (const s of slots) {
    const i = slotIndex(s.slot_start)
    if (i >= 0) cells[i] = s
  }
  return cells
}

/** Rides: the number in the cell, 0 blank (UD-25); levels scale to the grid's busiest cell. */
export function rideRows(days: RideDay[], todayWeekday: number): HeatRow[] {
  const max = Math.max(0, ...days.flatMap((d) => d.slots.map((s) => s.ride_count)))
  return days.map((d) => {
    const label = dayLabel(d.date, d.weekday)
    const weather = dayWeather(d.slots.map((s) => s.weather))
    return {
      date: d.date,
      label,
      bold: d.weekday === todayWeekday,
      weather: weather && weatherKind(weather.weather),
      cells: place(d.slots).map((s): HeatCell | null =>
        s && { level: rideLevel(s.ride_count, max), text: s.ride_count > 0 ? String(s.ride_count) : '', label: `${label} ${slotRange(s.slot_start)} 載客 ${s.ride_count} 次` },
      ),
    }
  })
}

/** "10/22 週四 08:15–08:30　車流 1,284 輛　平均 23 km/h": the cell's read-out and the detail line (ui-oi-21). */
export function trafficDetail(label: string, s: TrafficSlot): string {
  const speed = s.avg_speed_kmh === null ? '—' : `${Math.round(s.avg_speed_kmh)} km/h`
  return `${label} ${slotRange(s.slot_start)}　車流 ${s.volume.toLocaleString('en-US')} 輛　平均 ${speed}`
}

/** Traffic: colour only, darker = more vehicles (UD-25). */
export function trafficRows(days: TrafficDay[], todayWeekday: number): HeatRow[] {
  const volumes = days.flatMap((d) => d.slots.map((s) => s.volume))
  const min = Math.min(...volumes)
  const max = Math.max(...volumes)
  return days.map((d) => {
    const label = dayLabel(d.date, d.weekday)
    const weather = dayWeather(d.slots.map((s) => s.weather))
    return {
      date: d.date,
      label,
      bold: d.weekday === todayWeekday,
      weather: weather && weatherKind(weather.weather),
      cells: place(d.slots).map((s): HeatCell | null => s && { level: trafficLevel(s.volume, min, max), label: trafficDetail(label, s) }),
    }
  })
}
