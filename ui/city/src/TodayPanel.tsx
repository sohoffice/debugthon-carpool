import { ErrorNote, SimulatedBadge, type CityToday, type CityTraffic } from '@carpool/shared'
import { RoadSpeedTable } from './RoadSpeedTable'
import { SectionTitle } from './SectionTitle'

interface TodayPanelProps {
  today: CityToday | undefined
  todayError: boolean
  traffic: CityTraffic | undefined
  trafficError: boolean
}

/** Right column: today's results, the trips saved largest, then the road speeds (REQ-079, REQ-080, UD-26). */
export function TodayPanel({ today, todayError, traffic, trafficError }: TodayPanelProps) {
  const rate = today?.match_rate
  return (
    <section aria-label="今日成效" className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-rule bg-white p-5">
      <SectionTitle mark={today?.simulated && '含模擬'}>今日成效</SectionTitle>
      {todayError && <ErrorNote>今日成效讀取失敗，顯示上一次的資料</ErrorNote>}
      {today && (
        <>
          <div className="rounded-control bg-brand p-4 text-white [--color-sim:var(--color-simulated-light)]">
            <p className="flex items-center gap-2 text-base font-medium">
              估計減少的車次
              {today.trips_saved_estimate && <SimulatedBadge label="估算" />}
            </p>
            <p className="mt-1 text-5xl font-bold tabular-nums">
              {today.trips_saved}
              <span className="ml-2 text-xl font-medium">車次</span>
            </p>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-rule rounded-control border border-rule">
            <Stat label="完成的共乘" value={String(today.completed)} />
            <Stat label="成功配對" value={rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`} />
            <Stat label="無車可配" value={String(today.no_match)} />
          </dl>
        </>
      )}
      {trafficError && <ErrorNote>車速讀取失敗，顯示上一次的資料</ErrorNote>}
      {traffic && today && <RoadSpeedTable traffic={traffic} today={today.today} />}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  )
}
