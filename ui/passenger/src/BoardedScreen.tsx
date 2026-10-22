import { Button, Plate, RouteStrip, type RouteStripItem, type TripView, type Vehicle } from '@carpool/shared'
import { CancelButton } from './CancelButton'

interface BoardedScreenProps {
  dropoffName: string | null
  dropoffStopId: number | null
  /** The backend sends the car and trip only while confirmed; these are what the screen kept or fetched. */
  vehicle: Vehicle | null
  trip: TripView | null
  busy: boolean
  onDone: () => void
}

/** The rest of the ride: from the passenger's stop to the end. The pickup is behind them (SC-P6). */
function remainingRoute(dropoffStopId: number | null, dropoffName: string | null, destinationName: string | null): RouteStripItem[] {
  const destination = destinationName === null ? [] : [{ key: 'destination', name: destinationName, kind: 'destination' as const }]
  // Getting off at the driver's destination: one row, which is where to get off.
  if (dropoffStopId === null) return destination.map((d) => ({ ...d, note: '下車' }))
  const dropoff: RouteStripItem[] = dropoffName === null ? [] : [{ key: `s${dropoffStopId}`, name: dropoffName, kind: 'dropoff', note: '下車' }]
  return [...dropoff, ...destination.map((d) => ({ ...d, note: '終點' }))]
}

/** 7.6 boarded: no ETA, pickup or map any more, only where to get off and "結束共乘" (DD-27, REQ-068). */
export function BoardedScreen({ dropoffName, dropoffStopId, vehicle, trip, busy, onDone }: BoardedScreenProps) {
  const items = remainingRoute(dropoffStopId, dropoffName, trip?.destination.name ?? null)
  return (
    <main className="flex h-full flex-col bg-canvas px-6 pt-[calc(var(--safe-top)+24px)] pb-(--safe-bottom)">
      <p className="text-lg font-semibold text-fg-soft">在車上</p>
      <h1 className="mt-2 text-[36px]/tight font-semibold">{dropoffName ? `在${dropoffName}下車` : '在車上了'}</h1>
      {vehicle && (
        <div className="mt-4 flex items-center gap-4">
          <Plate plate={vehicle.plate} />
          <span className="min-w-0 text-lg">{vehicle.description}</span>
        </div>
      )}
      <div className="mt-8 min-h-0 flex-1 overflow-y-auto border-t border-line pt-4">{items.length > 0 && <RouteStrip items={items} label="這趟的路線" />}</div>
      <Button className="h-16 w-full text-xl" disabled={busy} onClick={onDone}>
        我已下車，結束共乘
      </Button>
      <div className="flex h-12 justify-center">
        <CancelButton />
      </div>
    </main>
  )
}
