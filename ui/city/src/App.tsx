import { ApiError, usePolling, type CityHistory, type CityLive, type CityToday, type CityTraffic } from '@carpool/shared'
import { useState } from 'react'
import { api, HISTORY_POLL_MS, LIVE_POLL_MS, TODAY_POLL_MS, TRAFFIC_POLL_MS } from './config'
import { HistoryBars } from './HistoryBars'
import { MapPanel, type MapTab } from './MapPanel'
import { PickupTable } from './PickupTable'
import { TodayPanel } from './TodayPanel'
import { TopBar } from './TopBar'
import { slotParam, slotTime, type SlotChoice } from './trafficSlots'

/** A city token for an account that is not a city admin: 401 for an unknown account, 403 otherwise (DD-39). */
const noAccess = (error: Error | undefined) => error instanceof ApiError && (error.status === 401 || error.status === 403)

/**
 * The city dashboard (SC-C1, UD-26): desktop only, read only. Each area polls on its own (DD-03) and
 * keeps its last data when a poll fails; only /api/city/* is called (DD-39).
 */
export function App() {
  const [tab, setTab] = useState<MapTab>('live')
  // null: the latest slot, which /api/city/traffic returns without a slot (DD-41).
  const [choice, setChoice] = useState<SlotChoice | null>(null)
  const [latestTime, setLatestTime] = useState<string>()

  const live = usePolling(() => api.get<CityLive>('/city/live'), LIVE_POLL_MS)
  const today = usePolling(() => api.get<CityToday>('/city/today'), TODAY_POLL_MS)
  const history = usePolling(() => api.get<CityHistory>('/city/history'), HISTORY_POLL_MS)
  const trafficPath = choice ? `/city/traffic?slot=${encodeURIComponent(slotParam(choice))}` : '/city/traffic'
  // The latest slot comes only from a response asked without a slot: after going back to the
  // latest slot, the past slot's response stays on screen until the new one arrives.
  const fetchTraffic = async () => {
    const data = await api.get<CityTraffic>(trafficPath)
    if (choice === null) setLatestTime(slotTime(data.slot_start))
    return data
  }
  const traffic = usePolling(fetchTraffic, TRAFFIC_POLL_MS, true, trafficPath)

  if ([live, today, history, traffic].some((p) => noAccess(p.error))) {
    return (
      <main className="flex h-dvh items-center justify-center bg-paper">
        <p role="alert" className="text-2xl font-bold text-ink">
          這個帳號沒有市府管理的權限。
        </p>
      </main>
    )
  }

  const clock = live.data ?? today.data ?? history.data ?? traffic.data
  const todayDate = clock?.today
  const shownSlot = choice ?? (todayDate && latestTime ? { date: todayDate, time: latestTime } : undefined)
  // Picking the latest slot again goes back to following the latest slot.
  const pickSlot = (c: SlotChoice) => setChoice(c.date === todayDate && c.time === latestTime ? null : c)

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper">
      <TopBar clock={clock} />
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_440px] grid-rows-[minmax(0,1fr)_260px]">
        <MapPanel
          tab={tab}
          onTab={setTab}
          live={live.data}
          liveError={!!live.error}
          traffic={traffic.data}
          trafficError={!!traffic.error}
          history={history.data}
          latestTime={latestTime}
          slot={shownSlot}
          onSlot={pickSlot}
        />
        <TodayPanel today={today.data} todayError={!!today.error} traffic={traffic.data} trafficError={!!traffic.error} />
        <div className="col-span-2 grid min-h-0 grid-cols-[minmax(0,1fr)_640px] border-t border-rule">
          <HistoryBars history={history.data} historyError={!!history.error} today={today.data} />
          <PickupTable history={history.data} live={live.data} today={today.data} error={!!(history.error || live.error || today.error)} />
        </div>
      </main>
    </div>
  )
}
