import type { CityLive } from '@carpool/shared'
import { SectionTitle } from './SectionTitle'

/** The four live numbers in the map's top right corner (REQ-078). */
export function LiveCountsCard({ live }: { live: CityLive }) {
  const rows: [string, number][] = [
    ['路上的共乘車', live.counts.vehicles],
    ['車上的乘客', live.counts.on_board],
    ['等待配對', live.counts.waiting],
    ['已配對、還沒上車', live.counts.matched],
  ]
  return (
    <section aria-label="此刻在路上" className="w-60 rounded-control bg-white/95 p-4 shadow-lg shadow-ink/20">
      <SectionTitle mark={live.simulated && '含模擬'}>此刻在路上</SectionTitle>
      <dl className="mt-2 space-y-1">
        {rows.map(([label, n]) => (
          <div key={label} className="flex items-baseline justify-between">
            <dt className="text-sm text-ink-soft">{label}</dt>
            <dd className="text-2xl font-bold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
