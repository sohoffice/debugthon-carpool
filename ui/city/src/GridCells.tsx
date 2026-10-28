import { SimulatedBadge, type CityGateway } from '@carpool/shared'
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
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
  /** Every header label, or every other one on desktop where the grid is narrow; below 1024px always every one (T79). */
  everyLabel: boolean
  /** Rows a fixed 13px, so the grid under the traffic map takes only what it needs. */
  fixedRows?: boolean
  label: string
  onCell: (cell: GridCell, gateway: CityGateway) => void
  /** Clicking a row name: only 車流熱力 selects a gateway that way (SC-C1). */
  onRow?: (gateway: CityGateway) => void
  selected?: string
  /** Below 1024px, the cell picked for the bar under the grid, outlined in brand (T85). */
  picked?: { vdId: string; time: string }
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

// Desktop rows are at least 13px with 2px gaps (gap-0.5).
const ROW_MIN_PX = 13
const ROW_GAP_PX = 2

/**
 * The stretching grid's least height on desktop: the header, every gateway and the freeway title at
 * ROW_MIN_PX. It is the grid's intrinsic height (contain-intrinsic-height), so 總覽's row is never
 * shorter: a short window scrolls 總覽 instead of letting the rows spill over the legend (T72). Without
 * it the grid would ask for its text's height, a pixel more per row, and 1440×900 would change.
 */
function minHeight(rows: GridRow[]): number {
  const lines = 1 + rows.length + (rows.some((r) => r.gateway.source === 'freeway') ? 1 : 0)
  return lines * ROW_MIN_PX + (lines - 1) * ROW_GAP_PX
}

// Below 1024px (T71, T72): slot columns at least 2.75rem, filling the width where there is room and
// scrolling sideways inside the grid where there is not, under a sticky name column.
const STICKY = 'max-lg:sticky max-lg:left-0 max-lg:z-2 max-lg:bg-white'

/**
 * Below 1024px, where the slots scroll sideways: keeps the framed slot's column in the middle of what
 * shows right of the sticky name column, so it is on screen without scrolling (T78). Only the grid
 * scrolls, never the page; on desktop every slot already fits.
 */
function useFramedInView(grid: RefObject<HTMLDivElement | null>, framed: number, onScrolled: () => void) {
  useEffect(() => {
    const g = grid.current
    const head = g?.querySelector<HTMLElement>('[data-framed]')
    const names = g?.firstElementChild
    if (g && head && names && g.scrollWidth > g.clientWidth) {
      const left = head.getBoundingClientRect().left - g.getBoundingClientRect().left + g.scrollLeft
      const nameWidth = names.getBoundingClientRect().width
      g.scrollLeft = left - nameWidth - (g.clientWidth - nameWidth - head.offsetWidth) / 2
    }
    onScrolled()
  }, [grid, framed, onScrolled])
}

/**
 * The slots whose whole column shows right of the sticky names, kept up to date while the grid is
 * swiped or resized: a time header is shown whole or not at all, never cut by the names or the
 * grid's edge (T79). All of them on desktop, where nothing scrolls.
 */
function useWholeSlots(grid: RefObject<HTMLDivElement | null>) {
  const [whole, setWhole] = useState<ReadonlySet<number> | null>(null)
  const measure = useCallback(() => {
    const g = grid.current
    if (!g) return
    const from = g.firstElementChild!.getBoundingClientRect().right
    const to = g.getBoundingClientRect().right
    const heads = [...g.querySelectorAll('[data-slot]')].map((h) => h.getBoundingClientRect())
    // Half a pixel either way: sub-pixel column widths must not hide a header that fits.
    const next = new Set(heads.flatMap((r, s) => (r.left >= from - 0.5 && r.right <= to + 0.5 ? [s] : [])))
    setWhole((prev) => (prev && prev.size === next.size && [...next].every((s) => prev.has(s)) ? prev : next))
  }, [grid])
  useEffect(() => {
    const g = grid.current
    if (!g) return
    // The grid is as wide as the window lets it be: a window resize is the only other change.
    g.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      g.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [grid, measure])
  return { whole, measure }
}

/** Gateways × 15-minute slots in UD-28's order, with the two groups' titles (REQ-079, SC-C1). */
export function GridCells({ rows, mode, framed, everyLabel, fixedRows = false, label, onCell, onRow, selected, picked, onHover }: GridCellsProps) {
  const firstFreeway = rows.findIndex((r) => r.gateway.source === 'freeway')
  const grid = useRef<HTMLDivElement>(null)
  const { whole, measure } = useWholeSlots(grid)
  useFramedInView(grid, framed, measure)
  return (
    <div
      ref={grid}
      role="grid"
      aria-label={label}
      className={`grid min-h-0 grid-cols-[8.5rem_repeat(12,minmax(2.75rem,1fr))] gap-0.5 text-xs/[18px] max-lg:auto-rows-[18px] max-lg:overflow-x-auto lg:grid-cols-[minmax(0,21rem)_repeat(12,minmax(0,1fr))] lg:leading-[13px] ${fixedRows ? 'lg:auto-rows-[13px]' : 'lg:flex-1 lg:auto-rows-[minmax(13px,1fr)] lg:[contain:size] lg:[contain-intrinsic-height:var(--grid-min)]'}`}
      style={{ '--grid-min': `${minHeight(rows)}px` } as CSSProperties}
      onMouseLeave={() => onHover?.(null)}
    >
      <span className={`font-bold tracking-wide text-ink-soft ${STICKY}`}>市區道路</span>
      {DAY_SLOTS.map((t, s) => (
        <span
          key={t}
          data-slot={s}
          data-framed={s === framed || undefined}
          // Hidden, not removed: the header keeps its column, so none moves to fit (T79).
          // Every other label only on desktop 總覽, where the columns are narrow; on a phone every column is wide enough (T79).
          className={`text-center whitespace-nowrap max-lg:text-xs lg:text-[11px] ${s === framed ? 'font-bold text-ink' : 'text-ink-soft'} ${whole && !whole.has(s) ? 'invisible' : ''} ${everyLabel || s % 2 === 0 || s === framed ? '' : 'lg:invisible'}`}
        >
          {t}
        </span>
      ))}
      {rows.map((r, i) => (
        <Fragment key={r.gateway.vd_id}>
          {i === firstFreeway && (
            <span className="col-span-full flex items-end border-b border-rule font-bold tracking-wide text-ink-soft max-lg:text-xs lg:text-[11px]">
              <span className="max-lg:sticky max-lg:left-0">國道 1 號出口匝道</span>
            </span>
          )}
          <RowName gateway={r.gateway} selected={selected === r.gateway.vd_id} onRow={onRow} />
          {r.cells.map((c, s) => {
            const isPicked = picked?.vdId === r.gateway.vd_id && picked.time === c.time
            return (
            <button
              key={c.time}
              type="button"
              role="gridcell"
              data-kind={c.kind}
              data-level={readCell(c.at, c.kind, mode).level ?? 'none'}
              data-picked={isPicked || undefined}
              aria-label={c.label}
              aria-selected={onRow ? selected === r.gateway.vd_id && s === framed : undefined}
              title={onHover ? undefined : c.label}
              // 總覽 opens a slot, so a cell without data does nothing; 車流熱力 still selects its gateway.
              disabled={c.kind === 'none' && !onRow}
              onClick={() => onCell(c, r.gateway)}
              onMouseMove={onHover && ((e) => onHover(c, { x: e.clientX, y: e.clientY }))}
              // An outline, so the four levels still read under it; brand, not ink, so it is not the framed slot (T85).
              className={`rounded-[2px] disabled:cursor-default ${cellClass(c, mode, s === framed)} ${isPicked ? 'relative z-1 outline-3 outline-offset-1 outline-brand' : ''}`}
            />
            )
          })}
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
        <em className="ml-1 text-ink-soft not-italic max-lg:hidden">{g.location_note}</em>
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
