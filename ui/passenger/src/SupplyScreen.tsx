import {
  Button,
  distanceM,
  ErrorNote,
  SimulatedBadge,
  usePolling,
  type BusStop,
  type LatLng,
  type PassengerSearch,
  type PickupPoint,
  type Supply,
} from '@carpool/shared'
import { useCallback } from 'react'
import { ArrivalTimeline } from './ArrivalTimeline'
import { api, POLL_INTERVAL_MS } from './config'
import { formatDistance, minutesOf, stopNames, supplyQueryString } from './search'
import { StationSign } from './StationSign'

interface SupplyScreenProps {
  search: PassengerSearch
  pickupPoints: PickupPoint[]
  pickup: PickupPoint
  position: LatLng | null
  busStops: BusStop[]
  /** One line on top, e.g. after a cancel. */
  notice: string | null
  onPickPickup: (id: number) => void
  onEdit: () => void
  onRide: () => void
}

/** The chosen pickup point's arrival board, polled (REQ-029, REQ-030). Remounted per pickup point. */
function PickupBoard({ search, pickup, distance }: { search: PassengerSearch; pickup: PickupPoint; distance: number | null }) {
  const query = supplyQueryString(pickup.id, search)
  const fetchSupply = useCallback(() => api.get<Supply>(`/passenger/supply?${query}`), [query])
  const { data: supply, error } = usePolling(fetchSupply, POLL_INTERVAL_MS)
  const waitLimitMin = supply ? Math.round(supply.timeline_range_s / 60) : 0

  return (
    <section aria-label={`${pickup.name}的接近車輛`}>
      {/* Only a hint: the backend checks the distance on submit (REQ-034, DD-25). */}
      <StationSign name={pickup.name} note={distance !== null ? `距離 ${formatDistance(distance)}` : undefined} />
      {/* The arrival board under the station sign: the one thing the passenger watches (UD-21). */}
      <div className="ground-asphalt min-h-[236px] bg-ink px-6 pt-6 pb-5">
        {!supply ? (
          <p className="text-lg text-fg-soft">{error ? '讀不到接近的車，正在重試。' : '正在找接近的車…'}</p>
        ) : (
          <>
            {supply.card.fastest_eta_s === null ? (
              <h1 className="pt-2 text-[40px]/tight font-semibold">{waitLimitMin} 分鐘內沒有車</h1>
            ) : (
              <h1 className="flex items-end gap-2.5">
                <span className="pb-1 text-xl font-semibold">最快</span>
                <span className="text-board digits-board">{minutesOf(supply.card.fastest_eta_s)}</span>
                <span className="pb-1 text-xl font-semibold">分鐘到</span>
                {/* REQ-063: the ETA came from the simulated route fallback (DD-09). */}
                {supply.card.fastest_eta_simulated && (
                  <span className="pb-1.5">
                    <SimulatedBadge label="估算" />
                  </span>
                )}
              </h1>
            )}
            <p className="mt-5 flex gap-6 text-lg font-semibold text-fg-soft">
              <span>{supply.card.count} 台車接近中</span>
              <span>空位 {supply.card.seats_remaining}</span>
            </p>
            <div className="mt-3">
              <ArrivalTimeline cars={supply.cars} rangeS={supply.timeline_range_s} />
            </div>
          </>
        )}
      </div>
      {supply && error && (
        <div className="mt-3 px-6">
          <ErrorNote>連線不穩，顯示的是上一次的資料。</ErrorNote>
        </div>
      )}
    </section>
  )
}

/** 7.2: how soon a car comes to the chosen pickup point. Cars cannot be picked (REQ-031). */
export function SupplyScreen({ search, pickupPoints, pickup, position, busStops, notice, onPickPickup, onEdit, onRide }: SupplyScreenProps) {
  const distanceTo = (p: PickupPoint) => (position ? distanceM(p, position) : null)
  const distance = distanceTo(pickup)
  const others = pickupPoints.filter((p) => p.id !== pickup.id)
  const alsoAt = stopNames(busStops, search.accepted_stop_ids)

  return (
    <div className="relative h-full bg-canvas">
      <main className="h-full overflow-y-auto overscroll-contain pt-[calc(var(--safe-top)+20px)] pb-[calc(var(--safe-bottom)+136px)]">
        <div className="flex items-start gap-4 px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold">到 {search.destination.name}</p>
            {alsoAt.length > 0 && <p className="mt-1 text-base text-fg-soft">也可以在 {alsoAt.join('、')} 下車</p>}
          </div>
          <button type="button" onClick={onEdit} className="h-11 shrink-0 rounded-full px-5 text-base font-semibold ring-[1.5px] ring-inset ring-line active:bg-sunk">
            修改
          </button>
        </div>
        {notice && <p className="mt-4 px-6 text-base font-semibold text-fg-soft">{notice}</p>}

        <div className="mt-5">
          <PickupBoard key={pickup.id} search={search} pickup={pickup} distance={distance} />
        </div>

        <h2 className="mt-8 px-6 text-base font-semibold text-fg-soft">換一個上車點</h2>
        <ul className="mt-2 border-t border-line">
          {others.map((p) => {
            const d = distanceTo(p)
            return (
              <li key={p.id} className="border-b border-line">
                <button type="button" onClick={() => onPickPickup(p.id)} className="flex h-14 w-full items-center gap-3 px-6 text-left active:bg-sunk">
                  <span aria-hidden className="h-3.5 w-6 rounded-full bg-brand" />
                  <span className="flex-1 text-lg font-semibold">{p.name}</span>
                  {d !== null && <span className="text-base text-fg-soft">距離 {formatDistance(d)}</span>}
                </button>
              </li>
            )
          })}
        </ul>

        <p className="mt-5 flex items-center gap-2 px-6 text-sm text-fg-soft">
          <SimulatedBadge label="模擬車輛" /> 車輛位置與到站時間由模擬器產生
        </p>
      </main>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-canvas from-70% to-transparent px-6 pt-8 pb-[calc(var(--safe-bottom)+12px)]">
        <Button className="h-16 w-full text-xl" onClick={onRide}>
          今天我要搭
        </Button>
        <p className="mt-2 text-center text-sm text-fg-soft">由平台替你分配車，不能自選</p>
      </div>
    </div>
  )
}
