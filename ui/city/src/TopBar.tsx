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

/**
 * Board-ink bar shared by the three tabs (UD-27): name, tabs, network lights, Demo clock (DD-41).
 * Below 1024px it is two rows (T71, T72): name and clock, then the tabs and the worst level's count across
 * the full width, so all three tabs fit whole from 320px (T81). The static site's 首頁 link pads the first child, the <h1>, on narrow screens (T68).
 * From 1024px to 1365px it is one row that fits with the 72px 首頁 link (T72): the name over 市府儀表板,
 * no 現在, and the lights only as the count.
 */
export function TopBar({ clock, tab, onTab, latest }: TopBarProps) {
  return (
    <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[48px_40px] items-center bg-ink whitespace-nowrap text-white [--color-sim:var(--color-simulated-light)] lg:flex lg:h-15 lg:gap-5 lg:pr-5">
      <h1 className="flex h-full min-w-0 items-center gap-2 overflow-hidden font-semibold lg:shrink-0 lg:gap-2.5 lg:overflow-visible lg:text-[17px]">
        <span className="h-full w-2 shrink-0 bg-brand" />
        {/* Below 1024px the name wraps after 起來: so it fits beside the clock with the static site's 首頁 link (T68). */}
        <span className="flex flex-col max-lg:text-[13px]/[15px] lg:max-xxl:leading-tight xxl:contents">
          <span className="max-lg:w-[7.5em] max-lg:whitespace-normal">內科上班順起來: 內科順路共乘</span>
          <span className="font-medium text-fog max-lg:text-xs lg:text-[15px] lg:max-xxl:text-[13px]">市府儀表板</span>
        </span>
      </h1>
      {/* Below 1024px the tabs and lights share their own full-width row, not the clock's column (T81). */}
      <div className="col-span-2 row-start-2 flex h-full min-w-0 lg:contents">
      <nav role="tablist" aria-label="分頁" className="flex h-full min-w-0 shrink-0 overflow-x-auto max-lg:pl-1 lg:overflow-visible">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => onTab(key)}
            className={`h-full shrink-0 border-y-4 border-transparent px-3 text-[15px] font-semibold lg:px-3.5 lg:text-[17px] ${tab === key ? 'border-b-brand-glow text-white' : 'text-fog'}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <NetworkLights latest={latest} />
      </div>
      {clock && (
        <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-1.5 pr-4 text-xs text-asphalt-soft lg:items-baseline lg:gap-2 lg:pr-0 lg:text-sm">
          <span>
            {monthDay(clock.today)} 週{weekdayOf(clock.today)}
          </span>
          <span className="max-xxl:hidden">現在</span>
          <span className="flex flex-col items-start gap-0.5 lg:contents">
            <span className="text-[22px]/none font-extrabold text-white tabular-nums lg:text-[28px]/none">{clockTime(clock.now)}</span>
            {clock.demo_clock && <SimulatedBadge label="模擬時間" />}
          </span>
        </div>
      )}
    </header>
  )
}

/**
 * 16 small blocks, one per gateway's level in the latest slot, and only the worst level's count (UD-27);
 * below 1366px only the count (T71, T72).
 */
function NetworkLights({ latest }: { latest: CityGateway[] | undefined }) {
  if (!latest) return <div className="ml-auto" />
  const levels = latest.map((g) => gatewayLevel(g))
  const worst = worstLevel(levels)
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2 pr-4 text-[13px] text-asphalt-soft lg:pr-0" aria-label="路網狀態" data-testid="network-lights">
      <span className="max-xxl:hidden">{latest.length} 個入口</span>
      <span className="flex gap-[3px] max-xxl:hidden">
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
