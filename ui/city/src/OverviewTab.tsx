import type { CityHistory, CityLive, CityToday, CityTrafficDay } from '@carpool/shared'
import { GatewayGrid } from './GatewayGrid'
import { HistoryBars } from './HistoryBars'
import { KpiRow } from './KpiRow'
import { PickupTable } from './PickupTable'
import { RequestsPanel } from './RequestsPanel'

interface OverviewTabProps {
  live: CityLive | undefined
  liveError: boolean
  today: CityToday | undefined
  todayError: boolean
  history: CityHistory | undefined
  historyError: boolean
  trafficDay: CityTrafficDay | undefined
  trafficDayError: boolean
  onCell: (time: string) => void
}

/**
 * 總覽, the default tab (SC-C1, before the Demo): the number row; the gateway × slot grid with today's
 * requests; the 10-day history with the pickup points.
 */
export function OverviewTab(p: OverviewTabProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_262px] gap-3.5 px-5 pt-4 pb-5">
      <KpiRow live={p.live} today={p.today} />
      <div className="grid min-h-0 grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3.5">
        <GatewayGrid day={p.trafficDay} error={p.trafficDayError} onCell={p.onCell} />
        <RequestsPanel today={p.today} live={p.live} error={p.todayError || p.liveError} />
      </div>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3.5">
        <HistoryBars history={p.history} historyError={p.historyError} today={p.today} />
        <PickupTable history={p.history} live={p.live} today={p.today} error={p.historyError || p.liveError || p.todayError} />
      </div>
    </div>
  )
}
