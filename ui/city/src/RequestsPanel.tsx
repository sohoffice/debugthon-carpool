import type { CityLive, CityToday } from '@carpool/shared'
import { Panel } from './Panel'

interface RequestsPanelProps {
  today: CityToday | undefined
  live: CityLive | undefined
  error: boolean
}

/** Today's requests: sent → matched → completed, then who got no car and who still waits (REQ-080, SC-C1). */
export function RequestsPanel({ today, live, error }: RequestsPanelProps) {
  const rate = today?.match_rate
  const title = today && `${today.requests} 個請求，${rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`} 配到車`
  const max = Math.max(1, today?.requests ?? 0)
  const width = (n: number) => `${Math.max((n / max) * 100, 1)}%`
  return (
    <Panel name="今天的請求" kicker="今天的請求" marks={[(today?.simulated || live?.simulated) && '含模擬']} title={title} error={error && '今天的請求讀取失敗，顯示上一次的資料'}>
      {today && (
        <dl className="flex flex-col gap-3">
          <Bar label="送出請求" n={today.requests} width={width(today.requests)} color="bg-road-1" />
          <Bar label="配到車" n={today.matched} width={width(today.matched)} color="bg-brand" />
          <Bar
            label="已完成"
            n={today.completed}
            width={width(today.completed)}
            color="bg-brand-dark"
            note={live && `另 ${live.counts.on_board} 人在車上、${live.counts.matched} 人等上車`}
          />
          <div className="flex items-center gap-4 border-t border-rule pt-3 text-[15px]">
            <dt className="text-ink-soft">沒配到：</dt>
            <dd className="flex items-center gap-1.5" data-testid="no-match">
              <i className="inline-block h-3.5 w-4 rounded-[3px] bg-danger" />
              無車可配 <b className="tabular-nums">{today.no_match}</b>
            </dd>
            <dd className="flex items-center gap-1.5" data-testid="still-waiting">
              <i className="inline-block h-3.5 w-4 rounded-[3px] bg-asphalt-soft" />
              還在等 <b className="tabular-nums">{live ? live.counts.waiting : '—'}</b>
            </dd>
          </div>
        </dl>
      )}
    </Panel>
  )
}

function Bar({ label, n, width, color, note }: { label: string; n: number; width: string; color: string; note?: string }) {
  return (
    <div>
      <dt className="flex items-baseline gap-3 text-sm text-ink-soft">
        {label}
        {note && <span className="text-[13px]">{note}</span>}
      </dt>
      <dd className="mt-1 flex items-center gap-2" data-testid={`bar-${label}`}>
        <span className={`h-4 rounded-[3px] ${color}`} style={{ width }} />
        <b className="text-lg font-extrabold tabular-nums [font-stretch:72%]">{n}</b>
      </dd>
    </div>
  )
}
