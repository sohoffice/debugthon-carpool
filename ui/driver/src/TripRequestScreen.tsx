import { SimulatedBadge, type DriverRequestItem } from '@carpool/shared'
import { ConnectionNote } from './ConnectionNote'
import { RequestMap } from './RequestMap'

interface TripRequestScreenProps {
  tripId: number
  /** Already confirmed, to say where else the car stops. */
  passengers: DriverRequestItem[]
  request: DriverRequestItem
  busy: boolean
  offline: boolean
  onAccept: () => void
  onDecline: () => void
}

/**
 * 6.3: the whole screen turns road-marking yellow, no animation or popup (UD-04). Confirm is the
 * biggest target, at the bottom where the thumb is; decline is smaller, below it (UD-05).
 */
export function TripRequestScreen({ tripId, passengers, request, busy, offline, onAccept, onDecline }: TripRequestScreenProps) {
  const others = passengers.map((p) => p.dropoff.name)
  return (
    <main className="flex h-full flex-col bg-signal px-6 pt-(--safe-top) pb-(--safe-bottom) text-ink">
      <h1 className="mt-6 text-[32px]/tight font-bold">有乘客要搭車</h1>

      <dl className="mt-8">
        <div className="relative pb-6 pl-10">
          <span aria-hidden className="absolute top-[7px] left-0 size-6 rounded-full border-[4px] border-ink" />
          <span aria-hidden className="absolute top-[31px] bottom-0 left-[10px] w-[4px] bg-ink" />
          <dt className="text-lg font-semibold">上車</dt>
          <dd className="text-drive font-bold break-words">{request.pickup_point.name}</dd>
        </div>
        <div className="relative pl-10">
          <span aria-hidden className="absolute top-0 left-[10px] h-[9px] w-[4px] bg-ink" />
          <span aria-hidden className="absolute top-[8px] left-[1px] size-[22px] rounded-[3px] bg-ink" />
          <dt className="text-lg font-semibold">下車</dt>
          <dd className="text-drive font-bold break-words">{request.dropoff.name}</dd>
        </div>
      </dl>
      {/* One line of text with the pickup and drop-off, no action (DD-04, DD-43). */}
      <p className="mt-4 flex items-center gap-3 text-xl font-semibold">
        同企業乘客 <SimulatedBadge />
      </p>

      {others.length > 0 && <p className="mt-8 text-xl font-semibold">其他乘客在 {others.join('、')} 下車</p>}
      {offline && <ConnectionNote />}

      {/* Takes the space above the buttons, so they stay put with or without the map (UD-05). */}
      <div className="my-6 min-h-0 flex-1 overflow-hidden rounded-control">
        <RequestMap tripId={tripId} request={request} />
      </div>

      <div className="flex flex-col gap-5 pb-4">
        <button
          type="button"
          disabled={busy}
          onClick={onAccept}
          className="h-[112px] rounded-control bg-ink text-drive-button font-bold text-white active:bg-ink-soft disabled:opacity-60"
        >
          確認
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          className="h-[72px] rounded-control text-2xl font-bold ring-[3px] ring-inset ring-ink active:bg-ink/10 disabled:opacity-60"
        >
          婉拒
        </button>
      </div>
    </main>
  )
}
