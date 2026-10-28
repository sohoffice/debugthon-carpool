import type { CityTrafficDay } from '@carpool/shared'
import { useState } from 'react'
import { CellPick, findPicked, type PickKey } from './CellPick'
import { gridRows, latestIndex, slowestRun } from './gatewayRows'
import { GridCells, GridLegend } from './GridCells'
import { Panel } from './Panel'
import { useNarrow } from './useNarrow'

interface GatewayGridProps {
  day: CityTrafficDay | undefined
  error: boolean
  /** Clicked a cell: its gateway and slot start, HH:mm; a slot not over yet is passed as is. */
  onCell: (vdId: string, time: string) => void
}

/**
 * Today's gateways × 15-minute slots, coloured by DD-44's level; the headline names the slowest run (REQ-079, SC-C1).
 * Below 1024px a tap only picks a cell and 看車流熱力 → opens it (T85); on desktop a click opens it.
 */
export function GatewayGrid({ day, error, onCell }: GatewayGridProps) {
  const narrow = useNarrow()
  const [pick, setPick] = useState<PickKey | null>(null)
  const rows = day ? gridRows(day) : []
  const picked = narrow ? findPicked(rows, pick) : null
  const latest = day ? latestIndex(day) : -1
  return (
    <Panel
      name="入口 × 15 分鐘"
      kicker={`進內湖的 ${rows.length || 16} 個入口 · 每 15 分鐘`}
      marks={[day?.simulated && '今天：模擬']}
      title={day && slowestRun(rows)}
      error={error && '車流資料讀取失敗，顯示上一次的資料'}
    >
      {day && (
        <GridCells
          rows={rows}
          mode="level"
          framed={latest}
          everyLabel={false}
          label="今天各入口每 15 分鐘的路況"
          picked={picked ? { vdId: picked.gateway.vd_id, time: picked.cell.time } : undefined}
          onCell={(c, g) => (narrow ? setPick({ vdId: g.vd_id, time: c.time }) : onCell(g.vd_id, c.time))}
        />
      )}
      {day && narrow && <CellPick picked={picked} mode="level" action="看車流熱力 →" onOpen={(p) => onCell(p.gateway.vd_id, p.cell.time)} />}
      {day && <GridLegend mode="level" notYet />}
    </Panel>
  )
}
