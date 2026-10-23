import type { CityGateway, CityTrafficDay } from '@carpool/shared'
import { gatewayLevel, LEVEL_NAMES, type CongestionLevel } from './congestion'
import { slotLabel } from './format'
import { slotTime } from './trafficSlots'

const SLOT_MS = 15 * 60 * 1000

/** data: the slot's traffic; not-yet: today after the latest slot, drawn from the past average; none: no data. */
export type CellKind = 'data' | 'not-yet' | 'none'

export interface GridCell {
  time: string
  kind: CellKind
  level: CongestionLevel | null
  speed: number | null
  /** Tooltip and accessible name. */
  label: string
  /** The gateway in this slot, for the line, the tooltip and 比平常. */
  at: CityGateway
}

export interface GridRow {
  gateway: CityGateway
  cells: GridCell[]
}

const over = (slotStart: string, now: string) => new Date(slotStart).getTime() + SLOT_MS <= new Date(now).getTime()

/** Index of the latest slot, the last one over by now (DD-41); -1 before 07:15. */
export function latestIndex(day: CityTrafficDay): number {
  return day.slots.reduce((last, s, i) => (over(s.slot_start, day.now) ? i : last), -1)
}

function cellOf(g: CityGateway, time: string, notYet: boolean): GridCell {
  const name = `${g.sort_order}. ${g.gateway} ${slotLabel(time)}`
  if (notYet) {
    const speed = g.past_avg_speed_kmh
    const level = speed === null ? null : gatewayLevel({ avg_speed_kmh: speed, reference_speed_kmh: g.reference_speed_kmh })
    return { time, kind: 'not-yet', level, speed, label: `${name} 還沒到${speed === null ? '' : `，平常 ${Math.round(speed)} km/h`}`, at: g }
  }
  const level = gatewayLevel(g)
  if (level === null || g.avg_speed_kmh === null) return { time, kind: 'none', level: null, speed: null, label: `${name} 沒有資料`, at: g }
  return { time, kind: 'data', level, speed: g.avg_speed_kmh, label: `${name} ${LEVEL_NAMES[level]} ${Math.round(g.avg_speed_kmh)} km/h`, at: g }
}

/** One row per gateway in the API's sort_order (UD-28), one cell per slot (REQ-079, SC-C1). */
export function gridRows(day: CityTrafficDay): GridRow[] {
  const gateways = day.slots[0]?.detectors ?? []
  return gateways.map((g) => ({
    gateway: g,
    cells: day.slots.map((s) => {
      const at = s.detectors.find((d) => d.vd_id === g.vd_id) ?? { ...g, avg_speed_kmh: null, past_avg_speed_kmh: null }
      return cellOf(at, slotTime(s.slot_start), !over(s.slot_start, day.now))
    }),
  }))
}

/** A row name short enough for the grid, as the mockup draws it: 國道1號高架 堤頂交流道（北向出口） → 國1 堤頂 北向出口. */
export function shortGateway(name: string): string {
  return name
    .replace(/^國道1號(高架)? (\S+?)交流道/, '國1 $2 ')
    .replace(/出口，/, '')
    .replace(/[（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const endOf = (time: string) => slotLabel(time).split('–')[1]

/**
 * The headline as a conclusion (UD-27): the slowest gateway of the day and the slots it is within one
 * level of its worst (at least 車多), short name as in UD-27, e.g. 「國1 堤頂 南向出口 07:30–09:15 最慢」.
 */
export function slowestRun(rows: GridRow[]): string {
  if (!rows.some((r) => r.cells.some((c) => c.kind === 'data'))) return '今天還沒有車流資料'
  let worst: { row: GridRow; ratio: number } | null = null
  for (const row of rows) {
    for (const c of row.cells) {
      if (c.kind !== 'data' || c.speed === null) continue
      const ratio = c.speed / row.gateway.reference_speed_kmh
      if (!worst || ratio < worst.ratio) worst = { row, ratio }
    }
  }
  const measured = worst ? worst.row.cells.filter((c) => c.kind === 'data') : []
  const worstLevel = Math.max(1, ...measured.map((c) => c.level ?? 1))
  if (!worst || worstLevel <= 1) return '今天各入口都順暢'
  const run = measured.filter((c) => (c.level ?? 0) >= Math.max(2, worstLevel - 1))
  return `${shortGateway(worst.row.gateway.gateway)} ${run[0].time}–${endOf(run[run.length - 1].time)} 最慢`
}
