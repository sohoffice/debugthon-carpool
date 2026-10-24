import { SimulatedBadge, type CityGateway } from '@carpool/shared'
import { Fragment } from 'react'
import { LEVEL_BG, LEVEL_NAMES, VS_USUAL_BG, VS_USUAL_NAMES, type CongestionLevel } from './congestion'
import type { GridCell, GridRow } from './gatewayRows'
import { shortGateway } from './gatewayRows'
import { DAY_SLOTS } from './trafficSlots'
import { readCell, type TrafficMode } from './trafficView'

// White hatching over a cell's colour: 還沒到 and 沒有資料 do not rely on colour alone (UD-28).
export const HATCH = 'bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.55)_0_2px,transparent_2px_5px)]'

interface GridCellsProps {
  rows: GridRow[]
  mode: TrafficMode
  /** The slot framed in ink: the latest slot on 總覽, the selected one on 車流熱力. */
  framed: number
  /** Every header label, or every other one where the grid is narrow. */
  everyLabel: boolean
  /** Rows a fixed 13px, so the grid under the traffic map takes only what it needs. */
  fixedRows?: boolean
  label: string
  onCell: (cell: GridCell, gateway: CityGateway) => void
  /** Clicking a row name: only 車流熱力 selects a gateway that way (SC-C1). */
  onRow?: (gateway: CityGateway) => void
  selected?: string
  onHover?: (cell: GridCell | null, at?: { x: number; y: number }) => void
}

function cellClass(c: GridCell, mode: TrafficMode, framed: boolean): string {
  const ring = framed ? 'relative z-1 ring-2 ring-ink' : ''
  const { level } = readCell(c.at, c.kind, mode)
  if (c.kind === 'none' || level === null) return `bg-no-data ${HATCH} ${ring}`
  const bg = mode === 'vs-usual' ? VS_USUAL_BG[level] : LEVEL_BG[level]
  if (c.kind === 'not-yet') return `${bg} ${HATCH} opacity-40`
  return `${bg} ${ring}`
}

// Below 768px (T71): fixed-width slot columns that scroll sideways inside the grid, under a sticky name column.
const STICKY = 'max-md:sticky max-md:left-0 max-md:z-2 max-md:bg-white'

/** Gateways × 15-minute slots in UD-28's order, with the two groups' titles (REQ-079, SC-C1). */
export function GridCells({ rows, mode, framed, everyLabel, fixedRows = false, label, onCell, onRow, selected, onHover }: GridCellsProps) {
  const firstFreeway = rows.findIndex((r) => r.gateway.source === 'freeway')
  return (
    <div
      role="grid"
      aria-label={label}
      className={`grid min-h-0 grid-cols-[8.5rem_repeat(12,2.75rem)] gap-0.5 text-xs/[18px] max-md:auto-rows-[18px] max-md:overflow-x-auto md:grid-cols-[minmax(0,21rem)_repeat(12,minmax(0,1fr))] md:leading-[13px] ${fixedRows ? 'md:auto-rows-[13px]' : 'md:flex-1 md:auto-rows-[minmax(13px,1fr)]'}`}
      onMouseLeave={() => onHover?.(null)}
    >
      <span className={`font-bold tracking-wide text-ink-soft ${STICKY}`}>市區道路</span>
      {DAY_SLOTS.map((t, s) => (
        <span key={t} className={`text-center whitespace-nowrap max-md:text-xs md:text-[11px] ${s === framed ? 'font-bold text-ink' : 'text-ink-soft'}`}>
          {everyLabel || s % 2 === 0 || s === framed ? t : ''}
        </span>
      ))}
      {rows.map((r, i) => (
        <Fragment key={r.gateway.vd_id}>
          {i === firstFreeway && (
            <span className="col-span-full flex items-end border-b border-rule font-bold tracking-wide text-ink-soft max-md:text-xs md:text-[11px]">
              <span className="max-md:sticky max-md:left-0">國道 1 號出口匝道</span>
            </span>
          )}
          <RowName gateway={r.gateway} selected={selected === r.gateway.vd_id} onRow={onRow} />
          {r.cells.map((c, s) => (
            <button
              key={c.time}
              type="button"
              role="gridcell"
              data-kind={c.kind}
              data-level={readCell(c.at, c.kind, mode).level ?? 'none'}
              aria-label={c.label}
              aria-selected={onRow ? selected === r.gateway.vd_id && s === framed : undefined}
              title={onHover ? undefined : c.label}
              // 總覽 opens a slot, so a cell without data does nothing; 車流熱力 still selects its gateway.
              disabled={c.kind === 'none' && !onRow}
              onClick={() => onCell(c, r.gateway)}
              onMouseMove={onHover && ((e) => onHover(c, { x: e.clientX, y: e.clientY }))}
              className={`rounded-[2px] disabled:cursor-default ${cellClass(c, mode, s === framed)}`}
            />
          ))}
        </Fragment>
      ))}
    </div>
  )
}

function RowName({ gateway: g, selected, onRow }: { gateway: CityGateway; selected: boolean; onRow?: (g: CityGateway) => void }) {
  const body = (
    <>
      <b className="inline-block min-w-[18px] font-extrabold text-ink-soft [font-stretch:72%]">{g.sort_order}</b>
      <span className="truncate">
        {shortGateway(g.gateway)}
        {g.proxy && ' *'}
        <em className="ml-1 text-ink-soft not-italic max-md:hidden">{g.location_note}</em>
      </span>
    </>
  )
  const cls = `flex min-w-0 items-center overflow-hidden pr-2 text-left whitespace-nowrap text-ink ${STICKY} ${selected ? 'font-bold' : ''}`
  if (!onRow) {
    return (
      <span role="rowheader" className={cls} title={`${g.gateway}，${g.location_note}`}>
        {body}
      </span>
    )
  }
  return (
    <button type="button" role="rowheader" aria-pressed={selected} className={cls} title={`${g.gateway}，${g.location_note}`} onClick={() => onRow(g)}>
      {body}
    </button>
  )
}

const LEVELS: CongestionLevel[] = [1, 2, 3, 4]

/** The grid's colours in the current mode; 還沒到 only when the day has slots not over yet. */
export function GridLegend({ mode, notYet }: { mode: TrafficMode; notYet: boolean }) {
  const [bg, names] = mode === 'vs-usual' ? [VS_USUAL_BG, VS_USUAL_NAMES] : [LEVEL_BG, LEVEL_NAMES]
  return (
    <div className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-1 pt-2 text-xs text-ink-soft">
      {LEVELS.map((l) => (
        <span key={l} className="flex items-center gap-1.5">
          <i className={`inline-block h-2 w-4.5 rounded-[2px] ${bg[l]}`} />
          {names[l]}
        </span>
      ))}
      {notYet && (
        <span className="flex items-center gap-1.5">
          <i className={`inline-block h-2 w-4.5 rounded-[2px] opacity-40 ${mode === 'vs-usual' ? 'bg-vs-usual-2' : 'bg-congestion-3'} ${HATCH}`} />
          還沒到（平常） <SimulatedBadge label="含模擬" />
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <i className={`inline-block h-2 w-4.5 rounded-[2px] bg-no-data ${HATCH}`} />
        沒有資料
      </span>
      <span>* 代理值</span>
      <span>{mode === 'vs-usual' ? '和其他天同時段平均比' : '速度 ÷ 全天 p85'}</span>
    </div>
  )
}
