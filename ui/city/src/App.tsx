import { ApiError, usePolling, type CityHistory, type CityLive, type CityToday, type CityTrafficDay } from '@carpool/shared'
import { useState } from 'react'
import { api, HISTORY_POLL_MS, LIVE_POLL_MS, TODAY_POLL_MS, TRAFFIC_POLL_MS } from './config'
import { latestIndex } from './gatewayRows'
import { LiveTab } from './LiveTab'
import { OverviewTab } from './OverviewTab'
import { TopBar, type Tab } from './TopBar'
import { TrafficTab } from './TrafficTab'
import { slotTime, type SlotChoice } from './trafficSlots'
import { defaultGateway, type TrafficMode } from './trafficView'

/** A city token for an account that is not a city admin: 401 for an unknown account, 403 otherwise (DD-39). */
const noAccess = (error: Error | undefined) => error instanceof ApiError && (error.status === 401 || error.status === 403)

/**
 * The city war room (SC-C1, UD-27): desktop only, read only, three tabs switched in React state.
 * Every area polls on its own whatever the tab (DD-03), so switching tabs never refetches, and keeps
 * its last data when a poll fails; only /api/city/* is called (DD-39).
 */
export function App() {
  const [tab, setTab] = useState<Tab>('overview')
  // null: today's latest slot, followed as time goes on (DD-41).
  const [choice, setChoice] = useState<SlotChoice | null>(null)
  const [mode, setMode] = useState<TrafficMode>('level')
  // undefined: the slowest gateway of the shown slot (SC-C1).
  const [picked, setPicked] = useState<string>()

  const live = usePolling(() => api.get<CityLive>('/city/live'), LIVE_POLL_MS)
  const today = usePolling(() => api.get<CityToday>('/city/today'), TODAY_POLL_MS)
  const history = usePolling(() => api.get<CityHistory>('/city/history'), HISTORY_POLL_MS)
  const clock = live.data ?? today.data ?? history.data
  const todayDate = clock?.today
  // Today's 12 slots: the overview grid, the top bar lights, the live overlay and today on 車流熱力 (DD-39).
  const dayPath = `/city/traffic?date=${todayDate ?? ''}`
  const trafficDay = usePolling(() => api.get<CityTrafficDay>(dayPath), TRAFFIC_POLL_MS, !!todayDate, dayPath)
  // A past date picked on 車流熱力: its own 12 slots, asked only while it is shown.
  const pastDate = choice && choice.date !== todayDate ? choice.date : undefined
  const pastPath = `/city/traffic?date=${pastDate ?? ''}`
  const pastDay = usePolling(() => api.get<CityTrafficDay>(pastPath), TRAFFIC_POLL_MS, !!pastDate, pastPath)

  if ([live, today, history, trafficDay, pastDay].some((p) => noAccess(p.error))) {
    return (
      <main className="flex h-dvh items-center justify-center bg-paper">
        <p role="alert" className="text-2xl font-bold text-ink">
          這個帳號沒有市府管理的權限。
        </p>
      </main>
    )
  }

  const day = trafficDay.data
  const latest = day ? day.slots[latestIndex(day)] : undefined
  const latestTime = latest && slotTime(latest.slot_start)
  const shownSlot = choice ?? (todayDate && latestTime ? { date: todayDate, time: latestTime } : undefined)
  const shownDay = pastDate ? pastDay.data : day
  const shownSlotData = shownDay && shownSlot ? shownDay.slots.find((s) => slotTime(s.slot_start) === shownSlot.time) : undefined
  const selected = picked ?? (shownSlotData && defaultGateway(shownSlotData))
  // Picking today's latest slot again goes back to following it.
  const pickSlot = (c: SlotChoice) => setChoice(c.date === todayDate && c.time === latestTime ? null : c)
  // A grid cell opens 車流熱力 at that gateway and slot of today; one not over yet opens the latest slot (SC-C1).
  const openCell = (vdId: string, time: string) => {
    const past = todayDate && latestTime && time < latestTime
    setChoice(past ? { date: todayDate, time } : null)
    setPicked(vdId)
    setTab('traffic')
  }

  return (
    <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-paper">
      <TopBar clock={clock} tab={tab} onTab={setTab} latest={latest?.detectors} />
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
        {tab === 'live' && <LiveTab live={live.data} liveError={!!live.error} today={today.data} history={history.data} trafficDay={day} />}
        {tab === 'traffic' && (
          <TrafficTab
            day={shownDay}
            dayError={!!(pastDate ? pastDay.error : trafficDay.error)}
            history={history.data}
            today={todayDate}
            latestTime={latestTime}
            slot={shownSlot}
            onSlot={pickSlot}
            mode={mode}
            onMode={setMode}
            selected={selected}
            onSelect={setPicked}
          />
        )}
      </main>
    </div>
  )
}
