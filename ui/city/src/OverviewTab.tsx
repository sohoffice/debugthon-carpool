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
  onCell: (vdId: string, time: string) => void
}

/**
 * 總覽, the default tab (SC-C1, before the Demo): the number row; the gateway × slot grid with today's
 * requests; the 10-day history with the pickup points. Below 1024px the areas stack in one column and
 * the page scrolls (T71, T72). On desktop the grid's row is never shorter than the 16 gateway rows
 * need: a shorter window scrolls 總覽 instead of letting them spill over the legend (T72).
 */
export function OverviewTab(p: OverviewTabProps) {
  return (
    <div className="flex flex-col gap-3.5 px-4 pt-4 pb-5 lg:grid lg:min-h-0 lg:flex-1 lg:grid-rows-[max-content_minmax(min-content,1fr)_min-content] lg:overflow-y-auto lg:px-5">
      <KpiRow live={p.live} today={p.today} />
      <div className="flex flex-col gap-3.5 lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <GatewayGrid day={p.trafficDay} error={p.trafficDayError} onCell={p.onCell} />
        <RequestsPanel today={p.today} live={p.live} error={p.todayError || p.liveError} />
      </div>
      <div className="flex flex-col gap-3.5 lg:grid lg:min-h-[262px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <HistoryBars history={p.history} historyError={p.historyError} today={p.today} />
        <PickupTable history={p.history} live={p.live} today={p.today} error={p.historyError || p.liveError || p.todayError} />
      </div>
    </div>
  )
}
