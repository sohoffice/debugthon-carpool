import { SimulatedBadge, type CityLive, type CityToday } from '@carpool/shared'
import type { ReactNode } from 'react'

interface KpiRowProps {
  live: CityLive | undefined
  today: CityToday | undefined
}

/**
 * The overview's number row (REQ-078, REQ-080, SC-C1): trips saved first and largest, then the
 * live and today numbers. The line under each is a supplementary number: "usual" comparisons have
 * no API yet (SC-C1, before the Demo).
 */
export function KpiRow({ live, today }: KpiRowProps) {
  const busiest = live?.pickup_points.reduce((a, b) => (b.waiting > a.waiting ? b : a), live.pickup_points[0])
  const rate = today?.match_rate
  const liveMark = live?.simulated && '含模擬'
  const todayMark = today?.simulated && '含模擬'
  return (
    <div className="grid min-h-28 grid-cols-[1.45fr_1fr_1fr_1fr_1fr] gap-3.5">
      <section aria-label="估計減少的車次" className="flex min-w-0 flex-col rounded-[8px] bg-brand px-4 py-3 text-white [--color-sim:var(--color-simulated-light)]">
        <p className="flex items-center gap-2 text-sm font-semibold text-brand-soft">
          估計減少的車次 {today?.trips_saved_estimate && <SimulatedBadge label="估算" />}
        </p>
        <Value n={today?.trips_saved} unit="車次" big />
        <p className="mt-auto text-[13px] text-brand-soft">{today && <>完成 <b className="text-white">{today.completed}</b> 趟共乘，每趟算少一台車</>}</p>
      </section>
      <Kpi name="路上的共乘車" mark={liveMark} n={live?.counts.vehicles} unit="台">
        {live && <>車上 <b className="text-ink">{live.counts.on_board}</b> 位乘客</>}
      </Kpi>
      <Kpi name="等待配對" mark={liveMark} n={live?.counts.waiting} unit="人">
        {busiest && (busiest.waiting > 0 ? <>{busiest.name} <b className="text-ink">{busiest.waiting}</b> 人最多</> : '三個上車點都沒有人在等')}
      </Kpi>
      <Kpi name="成功配對" mark={todayMark} n={rate === null || rate === undefined ? undefined : Math.round(rate * 100)} unit="%">
        {today && <><b className="text-ink">{today.matched}</b> / {today.requests} 個請求</>}
      </Kpi>
      <Kpi name="無車可配" mark={todayMark} n={today?.no_match} unit="次">
        {today && <>送出 {today.requests} 個請求中</>}
      </Kpi>
    </div>
  )
}

function Kpi({ name, mark, n, unit, children }: { name: string; mark: string | false | undefined; n: number | undefined; unit: string; children: ReactNode }) {
  return (
    <section aria-label={name} className="flex min-w-0 flex-col rounded-[8px] border border-rule bg-white px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
        {name} {mark && <SimulatedBadge label={mark} />}
      </p>
      <Value n={n} unit={unit} />
      <p className="mt-auto text-[13px] text-ink-soft">{children}</p>
    </section>
  )
}

function Value({ n, unit, big = false }: { n: number | undefined; unit: string; big?: boolean }) {
  return (
    <p className="mt-0.5 flex items-baseline gap-1.5">
      <b data-testid="kpi-value" className={`font-extrabold tracking-tight tabular-nums [font-stretch:72%] ${big ? 'text-[58px]/none' : 'text-5xl/none'}`}>
        {n ?? '—'}
      </b>
      <span className={`text-base font-semibold ${big ? 'text-brand-soft' : 'text-ink-soft'}`}>{unit}</span>
    </p>
  )
}
