import type { CityTrafficDay } from '@carpool/shared'
import { congestionLevel } from './congestion'
import { DAY_SLOTS } from './trafficSlots'

interface SpeedLineProps {
  day: CityTrafficDay
  vdId: string
  /** The selected slot, marked with a dot. */
  slot: number
  /** The day's slots over by now; later ones have no speed yet. */
  over: number
}

const W = 326
const H = 150
const PAD = { l: 28, r: 8, t: 8, b: 20 }
// The three thresholds of DD-44, drawn in the colour of the level below each (UD-28).
const THRESHOLDS: [number, string][] = [
  [0.75, 'var(--color-congestion-2)'],
  [0.5, 'var(--color-congestion-3)'],
  [0.3, 'var(--color-congestion-4)'],
]

/**
 * The selected gateway through the day (SC-C1): that day's speed in a thick ink line, the other days'
 * range at the same time as a grey band and their average dashed, and the three thresholds.
 */
export function SpeedLine({ day, vdId, slot, over }: SpeedLineProps) {
  const at = day.slots.map((s) => s.detectors.find((g) => g.vd_id === vdId))
  const ref = at.find((g) => g)?.reference_speed_kmh ?? 60
  const values = at.flatMap((g) => [g?.avg_speed_kmh, g?.past_max_speed_kmh].filter((v): v is number => v != null))
  const max = Math.ceil(Math.max(ref * 1.1, ...values) / 20) * 20
  const x = (s: number) => PAD.l + ((s + 0.5) / DAY_SLOTS.length) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)
  const line = (pts: [number, number][]) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join('')
  const past = at.flatMap((g, s) => (g?.past_min_speed_kmh != null && g.past_max_speed_kmh != null && g.past_avg_speed_kmh != null ? [{ s, g }] : []))
  const band = past.length > 1 ? line(past.map(({ s, g }) => [x(s), y(g.past_max_speed_kmh!)])) + [...past].reverse().map(({ s, g }) => `L${x(s)} ${y(g.past_min_speed_kmh!)}`).join('') + 'Z' : ''
  const today = at.flatMap((g, s) => (s < over && g?.avg_speed_kmh != null ? [[x(s), y(g.avg_speed_kmh)] as [number, number]] : []))
  const dot = at[slot]?.avg_speed_kmh
  const grid = Array.from({ length: max / 20 + 1 }, (_, i) => i * 20)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="選取入口的速度線">
      {grid.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-rule)" strokeOpacity={v ? 0.5 : 1} />
          <text x={PAD.l - 5} y={y(v) + 4} textAnchor="end" className="text-[13px] md:text-[10px]" fill="var(--color-ink-soft)">
            {v}
          </text>
        </g>
      ))}
      {[0, 4, 8].map((s) => (
        <text key={s} x={x(s)} y={H - 5} textAnchor="middle" className="text-[13px] md:text-[10px]" fill="var(--color-ink-soft)">
          {DAY_SLOTS[s]}
        </text>
      ))}
      {band && <path d={band} fill="var(--color-rule)" fillOpacity={0.7} />}
      {past.length > 1 && <path d={line(past.map(({ s, g }) => [x(s), y(g.past_avg_speed_kmh!)]))} fill="none" stroke="var(--color-ink-soft)" strokeWidth={1.5} strokeDasharray="4 3" />}
      {THRESHOLDS.map(([f, c]) => (
        <line key={f} x1={PAD.l} x2={W - PAD.r} y1={y(ref * f)} y2={y(ref * f)} stroke={c} strokeDasharray="3 3" />
      ))}
      {today.length > 0 && <path d={line(today)} fill="none" stroke="var(--color-ink)" strokeWidth={2.5} strokeLinejoin="round" />}
      {dot != null && slot < over && <circle cx={x(slot)} cy={y(dot)} r={5} fill={`var(--color-congestion-${congestionLevel(dot / ref)})`} stroke="white" strokeWidth={2} />}
      {today.length === 0 && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={13} fill="var(--color-ink-soft)">
          這天沒有資料
        </text>
      )}
    </svg>
  )
}
