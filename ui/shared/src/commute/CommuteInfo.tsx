import { useEffect, useState } from 'react'
import type { ApiClient } from '../api/client'
import type { CommuteTraffic, CommuteWeather, PickupPoint, PickupRides } from '../api/types'
import { ErrorNote } from '../ui/ErrorNote'
import { PickupEditor } from '../ui/PickupEditor'
import { CommuteSheet } from './CommuteSheet'
import { HeatGrid, type Ground } from './HeatGrid'
import { rideRows, trafficDetail, trafficRows } from './rows'
import { dayLabel, defaultWindow, formatMinutes, formatWindow, isoWeekdayOf, slotIndex, weekdayName, type SlotWindow } from './slots'
import { WeatherCard } from './WeatherCard'
import { WindowSheet } from './WindowSheet'

/** Off commute hours and without any now to go by (both now-bearing APIs failed), DD-38's window. */
const FALLBACK_WINDOW: SlotWindow = { from: 8 * 60, to: 8 * 60 + 30 }

interface CommuteInfoProps {
  api: ApiClient
  /** Driver: asphalt with the dark scales; passenger: white with the light ones (8.1). */
  ground: Ground
  /** Driver: the usual pickup point; passenger: the one chosen now (DD-38). Null: the first. */
  defaultPickupId: number | null
  onBack: () => void
}

/** One API's last good answer and whether the latest call failed: a failure keeps the data (6, ui/CLAUDE.md). */
interface Loaded<T> {
  data: T | null
  failed: boolean
}
const empty = { data: null, failed: false }

/**
 * Commute info, shared by the driver and the passenger (DD-38, UD-25, SC-X4): today's weather, the
 * pickup point's rides with a summary, and the traffic, on the same rows and columns. The default
 * window is around the Phase 2 now of the API, never the device clock (DD-41). Each block loads on
 * its own, so one failing API leaves the others in place.
 */
export function CommuteInfo({ api, ground, defaultPickupId, onBack }: CommuteInfoProps) {
  const [weather, setWeather] = useState<Loaded<CommuteWeather>>(empty)
  const [traffic, setTraffic] = useState<Loaded<CommuteTraffic>>(empty)
  const [rides, setRides] = useState<Loaded<PickupRides>>(empty)
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([])
  const [pickupPointsFailed, setPickupPointsFailed] = useState(false)
  const [pickupId, setPickupId] = useState<number | null>(defaultPickupId)
  const [chosenWindow, setChosenWindow] = useState<SlotWindow | null>(null)
  const [sheet, setSheet] = useState<'pickup' | 'window' | null>(null)
  const [selected, setSelected] = useState<{ date: string; slot: number } | null>(null)

  useEffect(() => {
    let current = true
    const load = <T,>(path: string, set: (l: Loaded<T>) => void) =>
      api.get<T>(path).then(
        (data) => current && set({ data, failed: false }),
        () => current && set({ data: null, failed: true }),
      )
    load('/commute/weather', setWeather)
    load('/commute/traffic', setTraffic)
    api.get<PickupPoint[]>('/pickup-points').then(
      (points) => current && (setPickupPoints(points), setPickupPointsFailed(false)),
      // No pickup point to ask the rides for: the rides block says so (ui/CLAUDE.md 6).
      () => current && setPickupPointsFailed(true),
    )
    return () => {
      current = false
    }
  }, [api])

  // Now from the weather, else from the traffic: the same Phase 2 now (DD-41).
  const now = weather.data?.now ?? traffic.data?.now ?? null
  const bothFailed = weather.failed && traffic.failed
  const win = chosenWindow ?? (now ? defaultWindow(now) : bothFailed ? FALLBACK_WINDOW : null)
  const pickup = pickupPoints.find((p) => p.id === pickupId) ?? pickupPoints[0] ?? null

  const pickupPointId = pickup?.id
  const from = win && formatMinutes(win.from)
  const to = win && formatMinutes(win.to)
  useEffect(() => {
    if (pickupPointId === undefined || !from || !to) return
    let current = true
    api.get<PickupRides>(`/commute/pickup-rides?pickup_point_id=${pickupPointId}&from=${from}&to=${to}`).then(
      (data) => current && setRides({ data, failed: false }),
      // Keep the last rides on screen (8.3).
      () => current && setRides((r) => ({ ...r, failed: true })),
    )
    return () => {
      current = false
    }
  }, [api, pickupPointId, from, to])

  const todayWeekday = rides.data?.summary.weekday ?? (traffic.data ? isoWeekdayOf(traffic.data.today) : weather.data ? isoWeekdayOf(weather.data.today) : 0)
  const selectedSlot = selected && traffic.data?.days.find((d) => d.date === selected.date)
  const detail = selected && selectedSlot ? cellDetail(selectedSlot, selected.slot) : null

  const choosePickup = (id: number) => (setPickupId(id), setSelected(null), setSheet(null))
  const chooseWindow = (w: SlotWindow) => (setChosenWindow(w), setSelected(null), setSheet(null))

  return (
    <div
      className={`absolute inset-0 z-30 bg-canvas ${ground === 'asphalt' ? 'ground-asphalt' : 'ground-light'}`}
      // A tap anywhere but the traffic grid clears the chosen cell (ui-oi-21).
      onClick={() => setSelected(null)}
    >
      <main aria-label="通勤資訊" className="h-full overflow-y-auto overscroll-contain px-5 pt-[calc(var(--safe-top)+4px)] pb-[calc(var(--safe-bottom)+24px)]">
        <header className="-ml-3 flex h-[52px] items-center gap-1.5">
          <button type="button" aria-label="返回" onClick={onBack} className="grid size-11 place-items-center rounded-sign-button">
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="size-[22px]">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <h1 className={`font-semibold ${ground === 'asphalt' ? 'lettering-sign text-[22px]' : 'text-xl'}`}>通勤資訊</h1>
        </header>

        {weather.data && <WeatherCard data={weather.data} />}
        {weather.failed && <ErrorNote>讀不到今天的天氣，其他資訊照常顯示</ErrorNote>}

        <div className="mt-3.5 flex flex-wrap gap-2">
          <Choice label="上車點" value={pickup?.name ?? '—'} onClick={() => setSheet('pickup')} disabled={pickupPoints.length === 0} />
          <Choice label="時段" value={win ? formatWindow(win) : '—'} onClick={() => setSheet('window')} disabled={!win} />
        </div>

        {(pickupPointsFailed || rides.failed) && (
          <div className="mt-3">
            <ErrorNote>{pickupPointsFailed ? '讀不到上車點，請稍後再試' : '讀不到載客次數，請稍後再試'}</ErrorNote>
          </div>
        )}
        {rides.data && win && (
          <>
            <Summary rides={rides.data} pickupName={pickupPoints.find((p) => p.id === rides.data!.pickup_point_id)?.name ?? ''} />
            <HeatGrid
              title="載客次數"
              scale="ride"
              ground={ground}
              rows={rideRows(rides.data.days, todayWeekday)}
              // The window these rides were asked for, which the summary states: after a failed
              // change the kept rides stay framed on their own window (UD-25).
              window={summaryWindow(rides.data)}
              simulated={rides.data.simulated}
            />
          </>
        )}

        {traffic.failed && (
          <div className="mt-5">
            <ErrorNote>讀不到車流，請稍後再試</ErrorNote>
          </div>
        )}
        {traffic.data && win && (
          <>
            <HeatGrid
              title="內湖車流"
              scale="road"
              ground={ground}
              rows={trafficRows(traffic.data.days, todayWeekday)}
              window={win}
              simulated={traffic.data.simulated}
              selected={selected}
              onSelect={(cell) => setSelected((s) => (s?.date === cell.date && s.slot === cell.slot ? null : cell))}
            />
            <p aria-live="polite" className="mt-2 text-sm text-fg-soft tabular-nums">
              {detail ?? '點一格看車流量與平均速度'}
            </p>
          </>
        )}
      </main>

      {sheet === 'pickup' && (
        <CommuteSheet title="選擇上車點" onClose={() => setSheet(null)}>
          <div className="mt-3">
            <PickupEditor pickupPoints={pickupPoints} value={pickup?.id ?? null} onChange={choosePickup} />
          </div>
        </CommuteSheet>
      )}
      {sheet === 'window' && win && <WindowSheet value={win} onDone={chooseWindow} onClose={() => setSheet(null)} />}
    </div>
  )
}

function summaryWindow(rides: PickupRides): SlotWindow {
  const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
  return { from: minutes(rides.summary.from), to: minutes(rides.summary.to) }
}

function cellDetail(day: CommuteTraffic['days'][number], slot: number): string | null {
  const s = day.slots.find((x) => slotIndex(x.slot_start) === slot)
  return s ? trafficDetail(dayLabel(day.date, day.weekday), s) : null
}

function Choice({ label, value, onClick, disabled }: { label: string; value: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-3.5 text-[15px] font-semibold whitespace-nowrap ring-[1.5px] ring-line ring-inset"
    >
      <span className="font-medium text-fg-soft">{label}</span>
      <span className="tabular-nums">{value}</span>
    </button>
  )
}

/** "過去 10 個上班日，松山車站 07:45–08:45 平均每天載客 35.9 次；星期一平均 32.0 次。" (REQ-056) */
function Summary({ rides, pickupName }: { rides: PickupRides; pickupName: string }) {
  const { from, to, daily_avg, weekday, same_weekday_avg } = rides.summary
  return (
    <p className="mt-3 text-[15.5px]/[1.55]">
      {`過去 ${rides.days.length} 個上班日，${pickupName} ${from}–${to} 平均每天載客 `}
      <b className="tabular-nums">{daily_avg.toFixed(1)}</b>
      {' 次'}
      {same_weekday_avg !== null && (
        <>
          {`；星期${weekdayName(weekday)}平均 `}
          <b className="tabular-nums">{same_weekday_avg.toFixed(1)}</b>
          {' 次'}
        </>
      )}
      。
    </p>
  )
}
