import {
  Button,
  ConfirmTextButton,
  RouteMap,
  RouteStrip,
  routeStripItems,
  SimulatedBadge,
  VehicleMarker,
  type PassengerRequest,
  type Ride,
} from '@carpool/shared'
import { POLL_INTERVAL_MS } from './config'
import { Plate } from './Plate'
import { minutesOf } from './search'

interface ConfirmedScreenProps {
  request: PassengerRequest & { ride: Ride }
  /** True right after the driver confirmed in this session: play the one choreographed transition (UD-10). */
  celebrate: boolean
  busy: boolean
  onBoarded: () => void
  onCancel: () => void
}

/** 7.4 confirmed: minutes first, then where, then which car, then the route (UD-09). */
export function ConfirmedScreen({ request, celebrate, busy, onBoarded, onCancel }: ConfirmedScreenProps) {
  const { ride } = request
  const strip = routeStripItems(request.pickup_point.name, ride.route.bus_stops, request.destination.name, { dropoffStopId: ride.dropoff.bus_stop_id })
  return (
    <div className="relative h-full bg-white">
      <div className="absolute inset-x-0 top-0 h-[42%]">
        <RouteMap
          pickup={request.pickup_point}
          destination={request.destination}
          route={ride.route}
          dropoffStopId={ride.dropoff.bus_stop_id}
          padding={{ top: 64, right: 40, bottom: 48, left: 40 }}
        >
          <VehicleMarker position={ride.position} pollIntervalMs={POLL_INTERVAL_MS} title={ride.vehicle.plate} />
        </RouteMap>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-(--safe-top) bottom-0 overflow-y-auto overscroll-contain">
        <div className="h-[32%]" />
        <section className="pointer-events-auto min-h-[68%] rounded-t-sheet bg-white px-6 pt-7 pb-[calc(var(--safe-bottom)+148px)] shadow-[0_-12px_32px_-16px_color-mix(in_srgb,var(--color-ink)_40%,transparent)]">
          <div className={celebrate ? 'after-route-draw' : ''}>
            {ride.eta_s !== null ? (
              <h1 className="flex items-end gap-3">
                <span className="font-board text-board-sm font-semibold tabular-nums">{minutesOf(ride.eta_s)}</span>
                <span className="pb-2 text-xl font-semibold">分鐘後到</span>
              </h1>
            ) : (
              <h1 className="text-[36px]/tight font-bold">車已到上車點</h1>
            )}
            <p className="mt-2 text-xl font-semibold">在{request.pickup_point.name}上車</p>
            <div className="mt-5 flex items-center gap-4">
              <Plate plate={ride.vehicle.plate} />
              <span className="min-w-0 text-lg">{ride.vehicle.description}</span>
            </div>
            {request.relaxed && <p className="mt-3 text-sm text-ink-soft">這台車不完全符合你的建議標籤</p>}
          </div>

          <div className={`mt-6 border-t border-rule pt-4 ${celebrate ? 'route-draw' : ''}`}>
            <RouteStrip items={strip.items} label="這趟的路線" />
          </div>
          <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
            <SimulatedBadge label="模擬車輛" /> 位置與到站時間由模擬器產生
          </p>

        </section>
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white from-75% to-transparent px-6 pt-8 pb-[calc(var(--safe-bottom)+4px)]">
        <Button className="h-16 w-full text-xl" disabled={busy} onClick={onBoarded}>
          我已上車
        </Button>
        <div className="flex h-12 justify-center">
          {request.can_cancel && <ConfirmTextButton label="取消請求" confirmLabel="再按一次確定取消" disabled={busy} onConfirm={onCancel} />}
        </div>
      </div>
    </div>
  )
}
