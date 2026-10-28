import type { CityGateway } from '@carpool/shared'
import { LEVEL_NAMES, VS_USUAL_NAMES } from './congestion'
import { slotLabel } from './format'
import { shortGateway, type GridCell, type GridRow } from './gatewayRows'
import { readCell, type TrafficMode } from './trafficView'

/** What a tap picks: a gateway and a slot, not the cell, so a new date or poll is read fresh (T85 review). */
export interface PickKey {
  vdId: string
  time: string
}

export interface Picked {
  cell: GridCell
  gateway: CityGateway
}

/** The picked cell in the rows shown now; null when that gateway or slot is not in them. */
export function findPicked(rows: GridRow[], key: PickKey | null): Picked | null {
  const row = key && rows.find((r) => r.gateway.vd_id === key.vdId)
  const cell = row && row.cells.find((c) => c.time === key.time)
  return row && cell ? { cell, gateway: row.gateway } : null
}

interface CellPickProps {
  picked: Picked | null
  mode: TrafficMode
  /** The button's words: 看車流熱力 → on 總覽, 在地圖上看 ↑ on 車流熱力. */
  action: string
  onOpen: (picked: Picked) => void
}

/**
 * 「2. 環東大道 08:00–08:15 · 順暢」: the picked cell in words, so the colour is not the only cue (UD-28).
 * The grid's short name, so a freeway exit fits in two lines on a phone.
 */
export function pickedText({ cell, gateway }: Picked, mode: TrafficMode): string {
  const name = `${gateway.sort_order}. ${shortGateway(gateway.gateway)} ${slotLabel(cell.time)}`
  if (cell.kind === 'not-yet') return `${name} · 還沒到`
  const { level } = readCell(cell.at, cell.kind, mode)
  if (cell.kind === 'none' || level === null) return `${name} · 沒有資料`
  return `${name} · ${mode === 'vs-usual' ? VS_USUAL_NAMES[level] : LEVEL_NAMES[level]}`
}

/**
 * Below 1024px a grid cell is only picked; this bar under the grid names it and opens it (T85, REQ-079).
 * Rows are 18px, so a 44px target on each cell would overlap its neighbours; one 44px button does not.
 * It keeps its height before a pick, so the page does not move on the first tap.
 */
export function CellPick({ picked, mode, action, onOpen }: CellPickProps) {
  return (
    <div data-testid="cell-pick" className="mt-2 flex min-h-[54px] items-center gap-3 rounded-[8px] border border-rule bg-paper py-1 pr-1 pl-3 lg:hidden">
      {/* Wraps instead of cutting: the slot and level are what was picked (UD-28). */}
      <p className={`min-w-0 flex-1 text-sm/tight ${picked ? 'font-semibold text-ink' : 'text-ink-soft'}`}>{picked ? pickedText(picked, mode) : '點一格選取入口與時段'}</p>
      <button
        type="button"
        disabled={!picked}
        onClick={() => picked && onOpen(picked)}
        className="h-11 shrink-0 rounded-[6px] bg-ink px-4 text-sm font-semibold whitespace-nowrap text-white disabled:bg-rule disabled:text-ink-soft"
      >
        {action}
      </button>
    </div>
  )
}
