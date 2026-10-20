import {
  Button,
  RouteMap,
  RouteStrip,
  routeStripItems,
  SimulatedBadge,
  VehicleMarker,
  type PickupPoint,
  type RequestStatusView,
  type TripView,
  type Vehicle,
} from '@carpool/shared'
import { CancelButton } from './CancelButton'
import { POLL_INTERVAL_MS } from './config'
import { Plate } from './Plate'
import { minutesOf } from './search'

interface ConfirmedScreenProps {
  request: RequestStatusView & { pickup_point: PickupPoint; vehicle: Vehicle; trip: TripView }
  /** True right after the driver confirmed in this session: play the one choreographed transition (UD-10). */
  celebrate: boolean
  busy: boolean
  onBoarded: () => void
}

/** The big line: minutes, or that the car is there (UD-09, DD-31). */
function Arrival({ request }: { request: ConfirmedScreenProps['request'] }) {
  // Judged by whether the car passed the pickup, never by a missing ETA: that also means "no position yet" (DD-31).
  if (request.passed_pickup) return <h1 className="text-[36px]/tight font-bold">車已到上車點</h1>
  if (request.eta_s === null) return <h1 className="text-[36px]/tight font-bold">車子正在來</h1>
  return (
    <h1 className="flex items-end gap-3">
      <span className="font-board text-board-sm font-semibold tabular-nums">{minutesOf(request.eta_s)}</span>
      <span className="pb-2 text-xl font-semibold">分鐘後到</span>
      {/* REQ-063: the ETA came from the simulated route fallback (DD-09). */}
      {request.eta_simulated && (
        <span className="pb-2">
          <SimulatedBadge label="估算" />
        </span>
      )}
    </h1>
  )
}

/** 7.5 confirmed: minutes first, then where, then which car, then the route (UD-09). */
export function ConfirmedScreen({ request, celebrate, busy, onBoarded }: ConfirmedScreenProps) {
  const { trip, vehicle } = request
  const dropoffStopId = request.dropoff_bus_stop_id
  const strip = trip.route && routeStripItems(request.pickup_point.name, trip.route.bus_stops, trip.destination.name, { dropoffStopId })
  return (
    <div className="relative h-full bg-white">
      <div className="absolute inset-x-0 top-0 h-[46%]">
        <RouteMap
          pickup={request.pickup_point}
          destination={trip.destination}
          route={trip.route}
          dropoffStopId={dropoffStopId}
          // The sheet starts at 34% and covers the map's lower part; keep the route above it.
          padding={{ top: 56, right: 48, bottom: 112, left: 48 }}
        >
          {/* Turned to the backend's heading; gone once the car has passed the pickup point (DD-31). */}
          {!request.passed_pickup && <VehicleMarker position={request.vehicle_position} pollIntervalMs={POLL_INTERVAL_MS} title={vehicle.plate} />}
        </RouteMap>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-(--safe-top) bottom-0 overflow-y-auto overscroll-contain">
        <div className="h-[34%]" />
        <section className="pointer-events-auto min-h-[68%] rounded-t-sheet bg-white px-6 pt-7 pb-[calc(var(--safe-bottom)+148px)] shadow-[0_-12px_32px_-16px_color-mix(in_srgb,var(--color-ink)_40%,transparent)]">
          <div className={celebrate ? 'after-route-draw' : ''}>
            <Arrival request={request} />
            <p className="mt-2 text-xl font-semibold">在{request.pickup_point.name}上車</p>
            <div className="mt-5 flex items-center gap-4">
              <Plate plate={vehicle.plate} />
              <span className="min-w-0 text-lg">{vehicle.description}</span>
            </div>
            {request.relaxed && <p className="mt-3 text-sm text-ink-soft">這台車不完全符合你的建議標籤</p>}
          </div>

          <div className={`mt-6 border-t border-rule pt-4 ${celebrate ? 'route-draw' : ''}`}>
            {strip && <RouteStrip items={strip.items} label="這趟的路線" />}
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
          <CancelButton />
        </div>
      </div>
    </div>
  )
}
