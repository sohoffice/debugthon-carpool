import { Button, RouteStrip, routeStripItems, type PassengerRequest, type Ride } from '@carpool/shared'
import { Plate } from './Plate'

interface BoardedScreenProps {
  request: PassengerRequest & { ride: Ride }
  busy: boolean
  onDone: () => void
}

/** 7.4 boarded: no ETA or pickup any more, only where to get off and "結束共乘" (DD-27, REQ-068). */
export function BoardedScreen({ request, busy, onDone }: BoardedScreenProps) {
  const { ride } = request
  const strip = routeStripItems(request.pickup_point.name, ride.route.bus_stops, request.destination.name, { dropoffStopId: ride.dropoff.bus_stop_id })
  return (
    <main className="flex h-full flex-col bg-paper px-6 pt-[calc(var(--safe-top)+24px)] pb-(--safe-bottom)">
      <p className="text-lg font-semibold text-ink-soft">在車上</p>
      <h1 className="mt-2 text-[36px]/tight font-bold">在{ride.dropoff.name}下車</h1>
      <div className="mt-4 flex items-center gap-4">
        <Plate plate={ride.vehicle.plate} />
        <span className="min-w-0 text-lg">{ride.vehicle.description}</span>
      </div>
      <div className="mt-8 min-h-0 flex-1 overflow-y-auto border-t border-rule pt-4">
        <RouteStrip items={strip.items} label="這趟的路線" />
      </div>
      <Button className="mb-4 h-16 w-full text-xl" disabled={busy} onClick={onDone}>
        我已下車，結束共乘
      </Button>
    </main>
  )
}
