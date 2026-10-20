import { Button, RouteStrip, routeStripItems, type TripView, type Vehicle } from '@carpool/shared'
import { CancelButton } from './CancelButton'
import { Plate } from './Plate'

interface BoardedScreenProps {
  dropoffName: string | null
  dropoffStopId: number | null
  /** The backend sends the car and trip only while confirmed; these are what the screen kept or fetched. */
  vehicle: Vehicle | null
  trip: TripView | null
  busy: boolean
  onDone: () => void
}

/** 7.6 boarded: no ETA, pickup or map any more, only where to get off and "結束共乘" (DD-27, REQ-068). */
export function BoardedScreen({ dropoffName, dropoffStopId, vehicle, trip, busy, onDone }: BoardedScreenProps) {
  const strip = trip?.route && routeStripItems(trip.pickup_point.name, trip.route.bus_stops, trip.destination.name, { dropoffStopId })
  return (
    <main className="flex h-full flex-col bg-paper px-6 pt-[calc(var(--safe-top)+24px)] pb-(--safe-bottom)">
      <p className="text-lg font-semibold text-ink-soft">在車上</p>
      <h1 className="mt-2 text-[36px]/tight font-bold">{dropoffName ? `在${dropoffName}下車` : '在車上了'}</h1>
      {vehicle && (
        <div className="mt-4 flex items-center gap-4">
          <Plate plate={vehicle.plate} />
          <span className="min-w-0 text-lg">{vehicle.description}</span>
        </div>
      )}
      <div className="mt-8 min-h-0 flex-1 overflow-y-auto border-t border-rule pt-4">{strip && <RouteStrip items={strip.items} label="這趟的路線" />}</div>
      <Button className="h-16 w-full text-xl" disabled={busy} onClick={onDone}>
        我已下車，結束共乘
      </Button>
      <div className="flex h-12 justify-center">
        <CancelButton />
      </div>
    </main>
  )
}
