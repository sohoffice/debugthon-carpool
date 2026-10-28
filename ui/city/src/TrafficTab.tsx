import { FitBounds, MapView, type CityHistory, type CityTrafficDay } from '@carpool/shared'
import { useState } from 'react'
import { CellPick, type Picked } from './CellPick'
import { LEVEL_BG, LEVEL_NAMES, VS_USUAL_BG, VS_USUAL_NAMES, type CongestionLevel } from './congestion'
import { GatewayDetail } from './GatewayDetail'
import { GatewayLines } from './GatewayLines'
import { gridRows, latestIndex, slowestRun, type GridCell } from './gatewayRows'
import { GridCells, GridLegend } from './GridCells'
import { monthDay, slotLabel, weekdayOf } from './format'
import { Panel } from './Panel'
import { SlowestPanel } from './SlowestPanel'
import { SourceBadge } from './SourceBadge'
import { TrafficControls } from './TrafficControls'
import { TrafficTip } from './TrafficTip'
import { DAY_SLOTS, type SlotChoice } from './trafficSlots'
import { gatewayPath, sourceOf, tooltipLines, type TrafficMode } from './trafficView'
import { useNarrow } from './useNarrow'

interface TrafficTabProps {
  /** The shown date's 12 slots. */
  day: CityTrafficDay | undefined
  dayError: boolean
  history: CityHistory | undefined
  today: string | undefined
  latestTime: string | undefined
  slot: SlotChoice | undefined
  onSlot: (choice: SlotChoice) => void
  mode: TrafficMode
  onMode: (mode: TrafficMode) => void
  selected: string | undefined
  onSelect: (vdId: string) => void
}

const LEVELS: CongestionLevel[] = [1, 2, 3, 4]
// The 16 gateways fill the map, clear of the legend top left and the date and source top right (UD-28).
const LINES_PADDING = { top: 72, right: 48, bottom: 32, left: 200 }
// Below 1024px the date and the legend sit across the map's top, so the lines go under them (T71, T72).
const NARROW_LINES_PADDING = { top: 190, right: 16, bottom: 16, left: 16 }
const LEVEL_RANGES = ['≥ 75%', '50–75%', '30–50%', '< 30%']
const LEVEL_WIDTH = [4, 5, 7, 9]
const VS_USUAL_WIDTH = [4, 4, 7, 9]

/**
 * 車流熱力 (SC-C1, UD-28): the 16 gateways' lines on the map, the date menu, time line and mode under
 * it, the same colours in the gateway × slot grid, and on the right the slowest three and the selected
 * gateway. Everything comes from the shown date's ?date= response (DD-39). Below 1024px everything stacks:
 * map, controls, grid, then the right column (T71, T72).
 */
export function TrafficTab(p: TrafficTabProps) {
  const [tip, setTip] = useState<{ cell: GridCell; at: { x: number; y: number } } | null>(null)
  const shown = p.day && p.slot && p.day.date === p.slot.date ? p.day : undefined
  const s = p.slot ? DAY_SLOTS.indexOf(p.slot.time) : -1
  const rows = shown ? gridRows(shown) : []
  const over = shown ? latestIndex(shown) + 1 : 0
  const slotCells = rows.map((r) => r.cells[s]).filter((c): c is GridCell => !!c)
  // Every gateway's line, so none falls under the legend or off the map (UD-28).
  const fitPoints = rows.flatMap((r) => gatewayPath(r.gateway))
  const narrow = useNarrow()
  const [picked, setPicked] = useState<Picked | null>(null)
  const slotData = shown?.slots[s]
  const isToday = !!shown && shown.date === p.today
  const source = slotData ? sourceOf(slotData, isToday && s >= over) : ''
  const hover = (cell: GridCell | null, at?: { x: number; y: number }) => setTip(cell && at ? { cell, at } : null)
  const tipLines = tip && shown ? tooltipLines(tip.cell.at, tip.cell.kind, shown.date, tip.cell.time, tip.cell.kind === 'not-yet' ? '還沒到' : sourceOf(shown.slots[DAY_SLOTS.indexOf(tip.cell.time)], false)) : null
  // A cell selects its gateway, and its slot when it has data; a cell without data keeps the slot (SC-C1).
  const open = ({ cell, gateway }: Picked) => {
    p.onSelect(gateway.vd_id)
    if (cell.kind === 'data' && shown) p.onSlot({ date: shown.date, time: cell.time })
  }
  const dayName = shown && (isToday ? `今天（${shown.simulated ? '模擬' : '實測'}）` : `${monthDay(shown.date)} 週${weekdayOf(shown.date)}（${shown.simulated ? '模擬' : '實測'}）`)

  return (
    <div className="flex flex-col lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col lg:min-h-0">
        <section aria-label="車流地圖" className="relative min-h-[280px] max-lg:h-[55dvh] lg:flex-1">
          <MapView>
            <FitBounds points={fitPoints} padding={narrow ? NARROW_LINES_PADDING : LINES_PADDING} />
            {shown && <GatewayLines cells={slotCells} mode={p.mode} selected={p.selected} onSelect={p.onSelect} onHover={hover} />}
          </MapView>
          <MapLegend mode={p.mode} />
          {p.slot && (
            <p className="absolute top-4 right-4 flex items-center gap-2 rounded-[8px] border border-rule bg-white/95 px-3 py-1.5 text-[15px] font-semibold text-ink max-lg:top-2 max-lg:right-2 max-lg:left-2 max-lg:text-sm" data-testid="map-slot">
              {monthDay(p.slot.date)} 週{weekdayOf(p.slot.date)} {slotLabel(p.slot.time)}
              <SourceBadge source={source} />
            </p>
          )}
        </section>
        {p.history && p.today && p.latestTime && p.slot ? (
          <TrafficControls today={p.today} days={p.history.days} latestTime={p.latestTime} value={p.slot} onChange={p.onSlot} mode={p.mode} onMode={p.onMode} />
        ) : (
          <p className="flex h-14 shrink-0 items-center border-t border-rule bg-white px-4 text-sm text-ink-soft">讀取時段中…</p>
        )}
        <Panel
          name="入口 × 15 分鐘（車流熱力）"
          kicker={dayName ?? '入口 × 15 分鐘'}
          title={shown && slowestRun(rows).replace(/^今天/, '')}
          error={p.dayError && '車流資料讀取失敗，顯示上一次的資料'}
          className="shrink-0 rounded-none border-x-0 border-b-0"
        >
          {shown && (
            <GridCells
              rows={rows}
              mode={p.mode}
              framed={s}
              everyLabel
              fixedRows
              label="所選日期各入口每 15 分鐘的路況"
              selected={p.selected}
              picked={narrow && picked ? { vdId: picked.gateway.vd_id, time: picked.cell.time } : undefined}
              onCell={(c, g) => (narrow ? setPicked({ cell: c, gateway: g }) : open({ cell: c, gateway: g }))}
              onRow={(g) => p.onSelect(g.vd_id)}
              onHover={hover}
            />
          )}
          {shown && narrow && (
            <CellPick
              picked={picked}
              mode={p.mode}
              action="在地圖上看 ↑"
              onOpen={(picked) => {
                open(picked)
                // The map is at the top of the stacked page (T71, T72).
                if (document.scrollingElement) document.scrollingElement.scrollTop = 0
              }}
            />
          )}
          {shown && <GridLegend mode={p.mode} notYet={isToday && over < DAY_SLOTS.length} />}
        </Panel>
      </div>
      <aside className="flex flex-col gap-3.5 border-rule bg-paper p-4 max-lg:border-t lg:min-h-0 lg:overflow-hidden lg:border-l">
        <SlowestPanel slot={slotData} time={p.slot?.time ?? DAY_SLOTS[0]} source={source} onSelect={p.onSelect} />
        <GatewayDetail day={shown} vdId={p.selected} slot={s} over={isToday ? over : DAY_SLOTS.length} isToday={isToday} />
      </aside>
      {tip && tipLines && <TrafficTip lines={tipLines} at={tip.at} />}
    </div>
  )
}

/** The map's legend for the mode, line widths included (UD-28). */
function MapLegend({ mode }: { mode: TrafficMode }) {
  const vs = mode === 'vs-usual'
  return (
    <div className="absolute top-4 left-4 rounded-[8px] border border-rule bg-white/95 px-3 py-2 text-[13px] whitespace-nowrap text-ink max-lg:top-16 max-lg:left-2 max-lg:px-2 max-lg:py-1.5 max-lg:text-xs" aria-label="圖例">
      <p className="mb-1 font-semibold">{vs ? '和其他天同時段比' : '路況（速度 ÷ 全天 p85）'}</p>
      {LEVELS.map((l) => (
        <p key={l} className="flex items-center gap-2">
          <i className={`inline-block w-6 rounded-full ${vs ? VS_USUAL_BG[l] : LEVEL_BG[l]}`} style={{ height: (vs ? VS_USUAL_WIDTH : LEVEL_WIDTH)[l - 1] }} />
          {vs ? VS_USUAL_NAMES[l] : LEVEL_NAMES[l]}
          {!vs && <span className="text-ink-soft">{LEVEL_RANGES[l - 1]}</span>}
        </p>
      ))}
      <p className="flex items-center gap-2 text-ink-soft">
        <i className="inline-block w-6 border-t-[3px] border-dashed border-no-data" />
        沒有資料
      </p>
      <p className="text-ink-soft">* 代理值</p>
    </div>
  )
}
