import { SimulatedBadge, type CityClock, type CityGateway } from '@carpool/shared'
import { gatewayLevel, LEVEL_BG, LEVEL_NAMES, worstLevel } from './congestion'
import { clockTime, monthDay, weekdayOf } from './format'

export type Tab = 'overview' | 'live' | 'traffic'

const TABS: [Tab, string][] = [
  ['overview', '總覽'],
  ['live', '即時地圖'],
  ['traffic', '車流熱力'],
]

interface TopBarProps {
  clock: CityClock | undefined
  tab: Tab
  onTab: (tab: Tab) => void
  /** The 16 gateways in the latest slot, for the network lights. */
  latest: CityGateway[] | undefined
}

/** Board-ink bar shared by the three tabs (UD-27): name, tabs, network lights, Demo clock (DD-41). */
export function TopBar({ clock, tab, onTab, latest }: TopBarProps) {
  return (
    <header className="flex h-15 shrink-0 items-center gap-5 bg-ink pr-5 whitespace-nowrap text-white [--color-sim:var(--color-simulated-light)]">
      <h1 className="flex h-full shrink-0 items-center gap-2.5 text-[17px] font-semibold">
        <span className="h-full w-2 bg-brand" />
        內科上班順起來: 內科順路共乘
        <span className="text-[15px] font-medium text-fog">市府儀表板</span>
      </h1>
      <nav role="tablist" aria-label="分頁" className="flex h-full shrink-0">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => onTab(key)}
            className={`h-full border-y-4 border-transparent px-3.5 text-[17px] font-semibold ${tab === key ? 'border-b-brand-glow text-white' : 'text-fog'}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <NetworkLights latest={latest} />
      {clock && (
        <div className="flex shrink-0 items-baseline gap-2 text-sm text-asphalt-soft">
          <span>
            {monthDay(clock.today)} 週{weekdayOf(clock.today)}
          </span>
          <span>現在</span>
          <span className="text-[28px]/none font-extrabold text-white tabular-nums">{clockTime(clock.now)}</span>
          {clock.demo_clock && <SimulatedBadge label="模擬時間" />}
        </div>
      )}
    </header>
  )
}

/** 16 small blocks, one per gateway's level in the latest slot, and only the worst level's count (UD-27). */
function NetworkLights({ latest }: { latest: CityGateway[] | undefined }) {
  if (!latest) return <div className="ml-auto" />
  const levels = latest.map((g) => gatewayLevel(g))
  const worst = worstLevel(levels)
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2 text-[13px] text-asphalt-soft" aria-label="路網狀態" data-testid="network-lights">
      {latest.length} 個入口
      <span className="flex gap-[3px]">
        {latest.map((g, i) => {
          const l = levels[i]
          return (
            <span
              key={g.vd_id}
              data-level={l ?? 'none'}
              title={`${g.sort_order}. ${g.gateway} ${l ? LEVEL_NAMES[l] : '沒有資料'}`}
              className={`h-4.5 w-2 rounded-[2px] ${l ? LEVEL_BG[l] : 'bg-no-data'}`}
            />
          )
        })}
      </span>
      {worst && (
        <b className="font-semibold text-white">
          {LEVEL_NAMES[worst.level]} {worst.count} 處
        </b>
      )}
    </div>
  )
}
