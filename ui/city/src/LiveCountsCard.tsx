import type { CityLive } from '@carpool/shared'
import { Panel } from './Panel'

/** The four live numbers in the live map's right column (REQ-078). */
export function LiveCountsCard({ live, error }: { live: CityLive | undefined; error: boolean }) {
  const rows: [string, number | undefined][] = [
    ['路上的共乘車', live?.counts.vehicles],
    ['車上的乘客', live?.counts.on_board],
    ['等待配對', live?.counts.waiting],
    ['已配對、還沒上車', live?.counts.matched],
  ]
  return (
    <Panel name="此刻在路上" kicker="此刻在路上" marks={[live?.simulated && '含模擬']} error={error && '即時資料讀取失敗，顯示上一次的資料'}>
      <dl className="mt-2 grid grid-cols-2 gap-x-3.5 gap-y-2.5">
        {rows.map(([label, n]) => (
          <div key={label}>
            <dt className="text-[13px] text-ink-soft">{label}</dt>
            <dd className="text-[40px]/none font-extrabold tabular-nums [font-stretch:72%]">{n ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}
