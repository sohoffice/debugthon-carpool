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
import { useCallback, useEffect, useState } from 'react'
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
function PickupBoard({ search, pickup, distance, onSubmitDistance }: {
  search: PassengerSearch
  pickup: PickupPoint
  distance: number | null
  onSubmitDistance: (m: number) => void
}) {
  const query = supplyQueryString({ ...search, pickup_point_id: pickup.id })
  const fetchSupply = useCallback(() => api.get<Supply>(`/passenger/supply?${query}`), [query])
  const { data: supply, error } = usePolling(fetchSupply, POLL_INTERVAL_MS)
  const within = supply && distance !== null ? distance <= supply.submit_distance_m : true
  const submitDistance = supply?.submit_distance_m
  useEffect(() => {
    if (submitDistance !== undefined) onSubmitDistance(submitDistance)
  }, [submitDistance, onSubmitDistance])

  return (
    <section aria-label={`${pickup.name}的接近車輛`}>
      <StationSign name={pickup.name} note={within ? '你在這裡' : distance !== null ? `距離 ${formatDistance(distance)}` : undefined} />
      {!supply ? (
        <p className="mt-8 px-6 text-lg text-ink-soft">{error ? '讀不到接近的車，正在重試。' : '正在找接近的車…'}</p>
      ) : (
        <>
          {supply.fastest_eta_s === null ? (
            <h1 className="mt-8 px-6 text-[40px]/tight font-bold">{supply.wait_limit_min} 分鐘內沒有車</h1>
          ) : (
            <h1 className="mt-8 flex items-end gap-3 px-6">
              <span className="pb-3 text-lg font-semibold">最快</span>
              <span className="font-board text-board font-semibold tabular-nums">{minutesOf(supply.fastest_eta_s)}</span>
              <span className="pb-3 text-lg font-semibold">分鐘到</span>
            </h1>
          )}
          <p className="mt-4 flex gap-6 px-6 text-lg font-semibold">
            <span>{supply.vehicle_count} 台車接近中</span>
            <span>空位 {supply.seats}</span>
          </p>
          <div className="mt-5">
            <ArrivalTimeline vehicles={supply.vehicles} waitLimitMin={supply.wait_limit_min} />
          </div>
          {error && (
            <div className="mt-3 px-6">
              <ErrorNote>連線不穩，顯示的是上一次的資料。</ErrorNote>
            </div>
          )}
        </>
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
  // The submit distance (REQ-034) comes with the supply; the backend checks it again on submit.
  const [submitDistance, setSubmitDistance] = useState<number | null>(null)
  const far = distance !== null && submitDistance !== null && distance > submitDistance

  return (
    <div className="relative h-full bg-paper">
      <main className="h-full overflow-y-auto overscroll-contain pt-[calc(var(--safe-top)+20px)] pb-[calc(var(--safe-bottom)+136px)]">
        <div className="flex items-start gap-4 px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold">到 {search.destination.name}</p>
            {alsoAt.length > 0 && <p className="mt-1 text-base text-ink-soft">也可以在 {alsoAt.join('、')} 下車</p>}
          </div>
          <button type="button" onClick={onEdit} className="h-11 shrink-0 rounded-control px-4 text-base font-semibold ring-1 ring-inset ring-rule active:bg-white">
            修改
          </button>
        </div>
        {notice && <p className="mt-4 px-6 text-base font-semibold text-ink-soft">{notice}</p>}

        <div className="mt-6">
          <PickupBoard key={pickup.id} search={search} pickup={pickup} distance={distance} onSubmitDistance={setSubmitDistance} />
        </div>

        <h2 className="mt-10 px-6 text-base font-semibold text-ink-soft">換一個上車點</h2>
        <ul className="mt-2 border-t border-rule">
          {others.map((p) => {
            const d = distanceTo(p)
            return (
              <li key={p.id} className="border-b border-rule">
                <button type="button" onClick={() => onPickPickup(p.id)} className="flex h-14 w-full items-center gap-3 px-6 text-left active:bg-white">
                  <span aria-hidden className="h-6 w-1.5 bg-brand" />
                  <span className="flex-1 text-lg font-semibold">{p.name}</span>
                  {d !== null && <span className="text-base text-ink-soft">距離 {formatDistance(d)}</span>}
                </button>
              </li>
            )
          })}
        </ul>

        <p className="mt-6 flex items-center gap-2 px-6 text-sm text-ink-soft">
          <SimulatedBadge label="模擬車輛" /> 車輛位置與到站時間由模擬器產生
        </p>
      </main>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-paper from-70% to-transparent px-6 pt-8 pb-[calc(var(--safe-bottom)+12px)]">
        <Button className="h-16 w-full text-xl" onClick={onRide}>
          今天我要搭
        </Button>
        <p className="mt-2 text-center text-sm text-ink-soft">{far ? '走到上車點附近才能送出' : '由平台替你分配車，不能自選'}</p>
      </div>
    </div>
  )
}
