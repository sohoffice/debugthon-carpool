import { CarDot, ErrorNote, HeatSpot, MapView, PlaceMarker, SimulatedBadge, type CityHistory, type CityLive, type CityTraffic } from '@carpool/shared'
import { LiveCountsCard } from './LiveCountsCard'
import { PickupWaitSigns } from './PickupWaitSigns'
import { SlotPicker } from './SlotPicker'
import type { SlotChoice } from './trafficSlots'

export type MapTab = 'live' | 'traffic'

interface MapPanelProps {
  tab: MapTab
  onTab: (tab: MapTab) => void
  live: CityLive | undefined
  liveError: boolean
  traffic: CityTraffic | undefined
  trafficError: boolean
  history: CityHistory | undefined
  latestTime: string | undefined
  slot: SlotChoice | undefined
  onSlot: (choice: SlotChoice) => void
}

/** Top left, the largest area: the live cars or the traffic heatmap on one map (UD-26). */
export function MapPanel({ tab, onTab, live, liveError, traffic, trafficError, history, latestTime, slot, onSlot }: MapPanelProps) {
  const maxVolume = Math.max(1, ...(traffic?.detectors.map((d) => d.volume) ?? []))
  const tabClass = (on: boolean) => `h-9 px-4 text-base font-bold ${on ? 'bg-ink text-white' : 'bg-white text-ink'}`
  return (
    <section aria-label="地圖" className="relative flex min-h-0 min-w-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <MapView>
          {tab === 'live' &&
            live?.vehicles.map((v, i) => <CarDot key={i} position={v} />)}
          {tab === 'live' && live?.pickup_points.map((p) => <PlaceMarker key={p.id} position={p} kind="pickup-option" title={p.name} />)}
          {tab === 'traffic' &&
            traffic?.detectors.map((d) => <HeatSpot key={d.vd_id} position={d} weight={d.volume / maxVolume} title={`${d.road_name} ${d.volume}`} />)}
        </MapView>

        <div className="absolute top-4 left-4 flex items-center gap-3">
          <div role="tablist" className="flex overflow-hidden rounded-[8px] border border-ink shadow-md shadow-ink/20">
            <button role="tab" aria-selected={tab === 'live'} className={tabClass(tab === 'live')} onClick={() => onTab('live')}>
              即時
            </button>
            <button role="tab" aria-selected={tab === 'traffic'} className={tabClass(tab === 'traffic')} onClick={() => onTab('traffic')}>
              車流
            </button>
          </div>
          {tab === 'traffic' && traffic?.simulated && (
            <span className="rounded-[6px] bg-white/95 px-1 py-0.5">
              <SimulatedBadge />
            </span>
          )}
        </div>

        {tab === 'live' && live && (
          <>
            <div className="absolute top-4 right-4">
              <LiveCountsCard live={live} />
            </div>
            <div className="absolute bottom-9 left-4">
              <PickupWaitSigns live={live} />
            </div>
          </>
        )}
        {((tab === 'live' && liveError) || (tab === 'traffic' && trafficError)) && (
          <div className="absolute right-4 bottom-4 rounded-[8px] bg-white/95 px-2">
            <ErrorNote>{tab === 'live' ? '即時資料讀取失敗，顯示上一次的資料' : '車流資料讀取失敗，顯示上一次的資料'}</ErrorNote>
          </div>
        )}
      </div>

      {tab === 'traffic' && (
        <div className="flex h-14 shrink-0 items-center border-t border-rule bg-white px-4">
          {history && live && latestTime && slot ? (
            <SlotPicker today={live.today} days={history.days} latestTime={latestTime} value={slot} onChange={onSlot} />
          ) : (
            <p className="text-sm text-ink-soft">讀取時段中…</p>
          )}
        </div>
      )}
    </section>
  )
}
