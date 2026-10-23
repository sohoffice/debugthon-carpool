import { HeatSpot, MapView, SimulatedBadge, type CityHistory, type CityTraffic } from '@carpool/shared'
import { Panel } from './Panel'
import { RoadSpeedTable } from './RoadSpeedTable'
import { SlotPicker } from './SlotPicker'
import type { SlotChoice } from './trafficSlots'

interface TrafficTabProps {
  traffic: CityTraffic | undefined
  trafficError: boolean
  history: CityHistory | undefined
  today: string | undefined
  latestTime: string | undefined
  slot: SlotChoice | undefined
  onSlot: (choice: SlotChoice) => void
}

/**
 * 車流熱力 for now: T41's traffic map, slot picker and speed table, moved into this tab as they are.
 * T56 replaces it with the gateway lines, the time line and the selected gateway (SC-C1).
 */
export function TrafficTab({ traffic, trafficError, history, today, latestTime, slot, onSlot }: TrafficTabProps) {
  const maxVolume = Math.max(1, ...(traffic?.detectors.map((d) => d.volume ?? 0) ?? []))
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px]">
      <section aria-label="車流地圖" className="flex min-h-0 min-w-0 flex-col">
        <div className="relative min-h-0 flex-1">
          <MapView>
            {traffic?.detectors.map((d) => (
              <HeatSpot key={d.vd_id} position={d} weight={(d.volume ?? 0) / maxVolume} title={`${d.gateway} ${d.volume ?? '—'}`} />
            ))}
          </MapView>
          {traffic?.simulated && (
            <span className="absolute top-4 left-4 rounded-[6px] bg-white/95 px-1 py-0.5">
              <SimulatedBadge />
            </span>
          )}
        </div>
        <div className="flex h-14 shrink-0 items-center border-t border-rule bg-white px-4">
          {history && today && latestTime && slot ? (
            <SlotPicker today={today} days={history.days} latestTime={latestTime} value={slot} onChange={onSlot} />
          ) : (
            <p className="text-sm text-ink-soft">讀取時段中…</p>
          )}
        </div>
      </section>
      <aside className="flex min-h-0 flex-col overflow-hidden border-l border-rule bg-paper p-4">
        <Panel name="入口車速" kicker="各入口車速" marks={[traffic?.simulated && '模擬']} error={trafficError && '車流資料讀取失敗，顯示上一次的資料'} className="overflow-hidden">
          {traffic && today && <RoadSpeedTable traffic={traffic} today={today} />}
        </Panel>
      </aside>
    </div>
  )
}
