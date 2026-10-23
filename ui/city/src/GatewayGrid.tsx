import { SimulatedBadge, type CityTrafficDay } from '@carpool/shared'
import { Fragment } from 'react'
import { LEVEL_BG, LEVEL_NAMES, type CongestionLevel } from './congestion'
import { gridRows, latestIndex, shortGateway, slowestRun, type GridCell } from './gatewayRows'
import { Panel } from './Panel'
import { DAY_SLOTS } from './trafficSlots'

interface GatewayGridProps {
  day: CityTrafficDay | undefined
  error: boolean
  /** Clicked a cell: its slot start, HH:mm; a slot not over yet is passed as is. */
  onCell: (time: string) => void
}

// White hatching over a cell's colour: 還沒到 and 沒有資料 do not rely on colour alone (UD-28).
const HATCH = 'bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.55)_0_2px,transparent_2px_5px)]'

function cellClass(c: GridCell, latest: boolean): string {
  const ring = latest ? 'relative z-1 ring-2 ring-ink' : ''
  if (c.kind === 'none' || c.level === null) return `bg-no-data ${HATCH} ${ring}`
  if (c.kind === 'not-yet') return `${LEVEL_BG[c.level]} ${HATCH} opacity-40`
  return `${LEVEL_BG[c.level]} ${ring}`
}

/** Today's gateways × 15-minute slots, coloured by DD-44's level; the headline names the slowest run (REQ-079, SC-C1). */
export function GatewayGrid({ day, error, onCell }: GatewayGridProps) {
  const rows = day ? gridRows(day) : []
  const latest = day ? latestIndex(day) : -1
  const firstFreeway = rows.findIndex((r) => r.gateway.source === 'freeway')
  return (
    <Panel
      name="入口 × 15 分鐘"
      kicker={`進內湖的 ${rows.length || 16} 個入口 · 每 15 分鐘`}
      marks={[day?.simulated && '今天：模擬']}
      title={day && slowestRun(rows)}
      error={error && '車流資料讀取失敗，顯示上一次的資料'}
    >
      {day && (
        <div role="grid" aria-label="今天各入口每 15 分鐘的路況" className="grid min-h-0 flex-1 grid-cols-[minmax(0,21rem)_repeat(12,minmax(0,1fr))] gap-0.5 text-xs/[13px]" style={{ gridAutoRows: 'minmax(13px,1fr)' }}>
          <span className="font-bold tracking-wide text-ink-soft">市區道路</span>
          {DAY_SLOTS.map((t, s) => (
            <span key={t} className={`text-center text-[11px] whitespace-nowrap ${s === latest ? 'font-bold text-ink' : 'text-ink-soft'}`}>
              {s % 2 === 0 || s === latest ? t : ''}
            </span>
          ))}
          {rows.map((r, i) => (
            <Fragment key={r.gateway.vd_id}>
              {i === firstFreeway && <span className="col-span-full flex items-end border-b border-rule text-[11px] font-bold tracking-wide text-ink-soft">國道 1 號出口匝道</span>}
              <span role="rowheader" className="flex min-w-0 items-center overflow-hidden pr-2 whitespace-nowrap text-ink" title={`${r.gateway.gateway}，${r.gateway.location_note}`}>
                <b className="inline-block min-w-[18px] font-extrabold text-ink-soft [font-stretch:72%]">{r.gateway.sort_order}</b>
                <span className="truncate">
                  {shortGateway(r.gateway.gateway)}
                  {r.gateway.proxy && ' *'}
                  <em className="ml-1 text-ink-soft not-italic">{r.gateway.location_note}</em>
                </span>
              </span>
              {r.cells.map((c, s) => (
                <button
                  key={c.time}
                  type="button"
                  role="gridcell"
                  data-kind={c.kind}
                  data-level={c.level ?? 'none'}
                  aria-label={c.label}
                  title={c.label}
                  disabled={c.kind === 'none'}
                  onClick={() => onCell(c.time)}
                  className={`rounded-[2px] disabled:cursor-default ${cellClass(c, s === latest)}`}
                />
              ))}
            </Fragment>
          ))}
        </div>
      )}
      {day && <Legend />}
    </Panel>
  )
}

function Legend() {
  const levels: CongestionLevel[] = [1, 2, 3, 4]
  return (
    <div className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-1 pt-2 text-xs text-ink-soft">
      {levels.map((l) => (
        <span key={l} className="flex items-center gap-1.5">
          <i className={`inline-block h-2 w-4.5 rounded-[2px] ${LEVEL_BG[l]}`} />
          {LEVEL_NAMES[l]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <i className={`inline-block h-2 w-4.5 rounded-[2px] bg-congestion-3 opacity-40 ${HATCH}`} />
        還沒到（平常） <SimulatedBadge label="含模擬" />
      </span>
      <span className="flex items-center gap-1.5">
        <i className={`inline-block h-2 w-4.5 rounded-[2px] bg-no-data ${HATCH}`} />
        沒有資料
      </span>
      <span>* 代理值</span>
      <span>速度 ÷ 全天 p85</span>
    </div>
  )
}
