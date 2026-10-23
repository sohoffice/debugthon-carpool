import { ApiError, usePolling, type CityHistory, type CityLive, type CityToday, type CityTraffic, type CityTrafficDay } from '@carpool/shared'
import { useState } from 'react'
import { api, HISTORY_POLL_MS, LIVE_POLL_MS, TODAY_POLL_MS, TRAFFIC_POLL_MS } from './config'
import { latestIndex } from './gatewayRows'
import { LiveTab } from './LiveTab'
import { OverviewTab } from './OverviewTab'
import { TopBar, type Tab } from './TopBar'
import { TrafficTab } from './TrafficTab'
import { slotParam, slotTime, type SlotChoice } from './trafficSlots'

/** A city token for an account that is not a city admin: 401 for an unknown account, 403 otherwise (DD-39). */
const noAccess = (error: Error | undefined) => error instanceof ApiError && (error.status === 401 || error.status === 403)

/**
 * The city war room (SC-C1, UD-27): desktop only, read only, three tabs switched in React state.
 * Every area polls on its own whatever the tab (DD-03), so switching tabs never refetches, and keeps
 * its last data when a poll fails; only /api/city/* is called (DD-39).
 */
export function App() {
  const [tab, setTab] = useState<Tab>('overview')
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

  const clock = live.data ?? today.data ?? history.data ?? traffic.data
  const todayDate = clock?.today
  // Today's 12 slots for the overview grid and the top bar lights (DD-39); asked once today is known.
  const dayPath = `/city/traffic?date=${todayDate ?? ''}`
  const trafficDay = usePolling(() => api.get<CityTrafficDay>(dayPath), TRAFFIC_POLL_MS, !!todayDate, dayPath)

  if ([live, today, history, traffic, trafficDay].some((p) => noAccess(p.error))) {
    return (
      <main className="flex h-dvh items-center justify-center bg-paper">
        <p role="alert" className="text-2xl font-bold text-ink">
          這個帳號沒有市府管理的權限。
        </p>
      </main>
    )
  }

  const shownSlot = choice ?? (todayDate && latestTime ? { date: todayDate, time: latestTime } : undefined)
  // Picking the latest slot again goes back to following the latest slot.
  const pickSlot = (c: SlotChoice) => setChoice(c.date === todayDate && c.time === latestTime ? null : c)
  const day = trafficDay.data
  const latest = day ? day.slots[latestIndex(day)]?.detectors : undefined
  // A grid cell opens 車流熱力 at that slot of today; one not over yet opens the latest slot (SC-C1).
  // The latest slot itself is null too, so the traffic tab keeps following it.
  const openCell = (time: string) => {
    const latestAt = day ? day.slots[latestIndex(day)]?.slot_start : undefined
    const past = todayDate && latestAt && time < slotTime(latestAt)
    setChoice(past ? { date: todayDate, time } : null)
    setTab('traffic')
  }

  return (
    <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-paper">
      <TopBar clock={clock} tab={tab} onTab={setTab} latest={latest} />
      <main className="flex min-h-0 flex-1 flex-col">
        {tab === 'overview' && (
          <OverviewTab
            live={live.data}
            liveError={!!live.error}
            today={today.data}
            todayError={!!today.error}
            history={history.data}
            historyError={!!history.error}
            trafficDay={day}
            trafficDayError={!!trafficDay.error}
            onCell={openCell}
          />
        )}
        {tab === 'live' && <LiveTab live={live.data} liveError={!!live.error} today={today.data} history={history.data} />}
        {tab === 'traffic' && (
          <TrafficTab
            traffic={traffic.data}
            trafficError={!!traffic.error}
            history={history.data}
            today={todayDate}
            latestTime={latestTime}
            slot={shownSlot}
            onSlot={pickSlot}
          />
        )}
      </main>
    </div>
  )
}
