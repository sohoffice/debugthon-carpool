import type { CityTrafficSlot } from '@carpool/shared'
import { LEVEL_BG, LEVEL_NAMES, congestionLevel } from './congestion'
import { slotLabel } from './format'
import { shortGateway } from './gatewayRows'
import { Panel } from './Panel'
import { SourceBadge } from './SourceBadge'
import { slowestThree } from './trafficView'

interface SlowestPanelProps {
  slot: CityTrafficSlot | undefined
  time: string
  source: string
  onSelect: (vdId: string) => void
}

/** The slot's three slowest gateways by speed ÷ reference, lowest first; a row selects the gateway (SC-C1). */
export function SlowestPanel({ slot, time, source, onSelect }: SlowestPanelProps) {
  const rows = slot ? slowestThree(slot) : []
  return (
    <Panel name="最慢的 3 個入口" kicker={`${slotLabel(time)} 最慢的 3 個入口`} kickerExtra={<SourceBadge source={source} />} className="shrink-0">
      {slot && rows.length === 0 && <p className="mt-2 text-sm text-ink-soft">這個時段沒有資料</p>}
      <ol className="mt-1">
        {rows.map((g, i) => {
          const r = g.avg_speed_kmh! / g.reference_speed_kmh
          const level = congestionLevel(r)
          return (
            <li key={g.vd_id} className="border-t border-rule first:border-t-0">
              <button type="button" onClick={() => onSelect(g.vd_id)} className="grid w-full grid-cols-[18px_1fr_auto] items-center gap-x-2.5 py-2 text-left">
                <span className="text-lg font-extrabold text-ink-soft">{i + 1}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-sm/tight text-ink">
                  <i className={`inline-block h-1.5 w-5 shrink-0 rounded-[2px] ${LEVEL_BG[level]}`} />
                  <span>
                    {g.sort_order}. {shortGateway(g.gateway)}
                    {g.proxy && ' *'}
                  </span>
                </span>
                <span className="text-right">
                  <b className="text-base font-bold tabular-nums">{Math.round(g.avg_speed_kmh!)} km/h</b>
                  <small className="block text-xs text-ink-soft">
                    {LEVEL_NAMES[level]} · 參考 {Math.round(r * 100)}%{g.past_avg_speed_kmh !== null && ` · 平常 ${Math.round(g.past_avg_speed_kmh)}`}
                  </small>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}
