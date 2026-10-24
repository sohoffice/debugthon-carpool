import type { CityTrafficDay } from '@carpool/shared'
import { congestionLevel, LEVEL_NAMES } from './congestion'
import { monthDay, slotLabel } from './format'
import { Panel } from './Panel'
import { SpeedLine } from './SpeedLine'
import { DAY_SLOTS } from './trafficSlots'
import { gatewayName, proxyLine } from './trafficView'

interface GatewayDetailProps {
  day: CityTrafficDay | undefined
  vdId: string | undefined
  slot: number
  /** The day's slots over by now. */
  over: number
  isToday: boolean
}

const round = (v: number | null) => (v === null ? '—' : String(Math.round(v)))

/**
 * The selected gateway (SC-C1): its speed line, then this slot's speed, the other days' average,
 * volume, occupancy and reference speed; a proxy names where its detector really is (DD-36).
 */
export function GatewayDetail({ day, vdId, slot, over, isToday }: GatewayDetailProps) {
  const g = vdId ? day?.slots[slot]?.detectors.find((d) => d.vd_id === vdId) : undefined
  const proxy = g && proxyLine(g)
  const speed = slot < over ? (g?.avg_speed_kmh ?? null) : null
  const level = g && speed !== null ? LEVEL_NAMES[congestionLevel(speed / g.reference_speed_kmh)] : null
  const rows: [string, string, string][] = g
    ? [
        [slotLabel(DAY_SLOTS[slot]), round(speed), `km/h${level ? ` · ${level}` : ''}`],
        ['其他天同時段', round(g.past_avg_speed_kmh), 'km/h'],
        ['車流', slot < over ? round(g.volume) : '—', '輛／15 分'],
        ['佔有率', slot < over ? round(g.occupancy_pct) : '—', '%'],
        ['參考速度（全天 p85）', String(g.reference_speed_kmh), 'km/h'],
      ]
    : []
  return (
    <Panel name="選取的入口" kicker="選取的入口" title={g ? gatewayName(g) : undefined} className="md:min-h-0 md:flex-1 md:overflow-hidden">
      {day && g && (
        <>
          <SpeedLine day={day} vdId={g.vd_id} slot={slot} over={over} />
          <p className="mt-0.5 flex gap-3 text-xs text-ink-soft">
            <span className="flex items-center gap-1">
              <i className="inline-block h-[3px] w-3.5 bg-ink" />
              {isToday ? '今天' : monthDay(day.date)}
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block h-2 w-3.5 bg-rule" />
              其他天範圍
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block w-3.5 border-t-[1.5px] border-dashed border-ink-soft" />
              平均
            </span>
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
            {rows.map(([label, value, unit]) => (
              <div key={label}>
                <dt className="text-xs text-ink-soft">{label}</dt>
                <dd>
                  <b className="text-xl font-extrabold tabular-nums [font-stretch:72%]">{value}</b> <small className="text-xs text-ink-soft">{unit}</small>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-auto pt-2 text-xs text-ink-soft">
            {proxy && `${proxy}。`}參考速度：全天 p85，10/12–10/22 全天約 800 個 15 分鐘時段中，速度最快 15% 的門檻。
          </p>
        </>
      )}
    </Panel>
  )
}
