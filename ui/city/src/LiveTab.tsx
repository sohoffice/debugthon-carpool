import { CarDot, MapView, PlaceMarker, type CityHistory, type CityLive, type CityToday, type CityTrafficDay } from '@carpool/shared'
import { useState } from 'react'
import { GatewayLines } from './GatewayLines'
import { gridRows, latestIndex } from './gatewayRows'
import { LiveCountsCard } from './LiveCountsCard'
import { Panel } from './Panel'
import { PickupWaitSigns } from './PickupWaitSigns'

interface LiveTabProps {
  live: CityLive | undefined
  liveError: boolean
  today: CityToday | undefined
  history: CityHistory | undefined
  /** Today's slots, for the 疊上車流 overlay at the latest slot. */
  trafficDay: CityTrafficDay | undefined
}

/** The live map, almost full width: unnamed cars (REQ-081); right column, the four live numbers and the pickup points (REQ-078). */
export function LiveTab({ live, liveError, today, history, trafficDay }: LiveTabProps) {
  const [overlay, setOverlay] = useState(false)
  const at = trafficDay ? latestIndex(trafficDay) : -1
  // 疊上車流: the latest slot's gateway lines, 80% opaque, under the cars (SC-C1).
  const lines = overlay && trafficDay && at >= 0 ? gridRows(trafficDay).map((r) => r.cells[at]) : []
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px]">
      <section aria-label="即時地圖" className="relative min-h-0 min-w-0">
        <MapView>
          {lines.length > 0 && <GatewayLines cells={lines} mode="level" overlay />}
          {live?.vehicles.map((v, i) => <CarDot key={i} position={v} />)}
          {live?.pickup_points.map((p) => <PlaceMarker key={p.id} position={p} kind="pickup-option" title={p.name} />)}
        </MapView>
        <label className="absolute top-4 left-4 flex items-center gap-2 rounded-[8px] border border-rule bg-white/95 px-3 py-1.5 text-[15px] font-semibold text-ink">
          <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} className="size-4 accent-ink" />
          疊上車流
        </label>
        {live && (
          <div className="absolute bottom-9 left-4">
            <PickupWaitSigns live={live} />
          </div>
        )}
      </section>
      <aside className="flex min-h-0 flex-col gap-3.5 overflow-hidden border-l border-rule bg-paper p-4">
        <LiveCountsCard live={live} error={liveError} />
        <Panel name="上車點" kicker="上車點" marks={[(live?.simulated || today?.simulated) && '含模擬']}>
          <ul className="mt-1">
            {live?.pickup_points.map((p) => {
              const done = today?.pickup_points.find((t) => t.id === p.id)?.completed
              const usual = history?.pickup_points.find((h) => h.id === p.id)
              return (
                <li key={p.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 border-t border-rule py-2 text-[13px] text-ink-soft">
                  <span className="rounded-[3px] bg-brand px-2 py-0.5 text-[15px] font-semibold text-white">{p.name}</span>
                  <span>
                    今天完成 <b className="text-ink">{done ?? '—'}</b>
                    {usual && (
                      <>
                        <br />平常每天載客 <b className="text-ink">{usual.rides_per_day}</b>
                      </>
                    )}
                  </span>
                  <b className="text-[28px] font-extrabold text-ink tabular-nums [font-stretch:72%]" aria-label={`${p.name} 等待 ${p.waiting} 人`}>
                    {p.waiting}
                  </b>
                </li>
              )
            })}
          </ul>
          <p className="mt-1 text-[13px] text-ink-soft">大數字是現在等待配對的人數。</p>
        </Panel>
      </aside>
    </div>
  )
}
