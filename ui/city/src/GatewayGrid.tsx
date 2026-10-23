import type { CityTrafficDay } from '@carpool/shared'
import { gridRows, latestIndex, slowestRun } from './gatewayRows'
import { GridCells, GridLegend } from './GridCells'
import { Panel } from './Panel'

interface GatewayGridProps {
  day: CityTrafficDay | undefined
  error: boolean
  /** Clicked a cell: its gateway and slot start, HH:mm; a slot not over yet is passed as is. */
  onCell: (vdId: string, time: string) => void
}

/** Today's gateways × 15-minute slots, coloured by DD-44's level; the headline names the slowest run (REQ-079, SC-C1). */
export function GatewayGrid({ day, error, onCell }: GatewayGridProps) {
  const rows = day ? gridRows(day) : []
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
          onCell={(c, g) => onCell(g.vd_id, c.time)}
        />
      )}
      {day && <GridLegend mode="level" notYet />}
    </Panel>
  )
}
