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
 * On a short screen (`short:`, driver/src/index.css) the type, buttons and gaps shrink so the map
 * keeps a readable height and both buttons stay on screen; the screen never scrolls (T76).
 */
export function TripRequestScreen({ tripId, passengers, request, busy, offline, onAccept, onDecline }: TripRequestScreenProps) {
  const others = passengers.map((p) => p.dropoff.name)
  const atStop = request.dropoff.bus_stop_id !== null
  return (
    // The container the `short:` variant measures: the screen's own height (T76).
    <div className="h-full [container:request/size]">
      <main className="flex h-full flex-col bg-signal px-6 pt-(--safe-top) pb-(--safe-bottom) text-ink">
        <h1 className="mt-6 text-[32px]/tight font-bold short:mt-4 short:text-[28px]/tight">有乘客要搭車</h1>

        {/* Short screen: the label sits beside the name, one line less per stop (T76). */}
        <dl className="mt-8 short:mt-4">
          <div className="relative pb-6 pl-10 short:flex short:items-baseline short:gap-3 short:pb-2">
            <span aria-hidden className="absolute top-[7px] left-0 size-6 rounded-full border-[4px] border-ink" />
            <span aria-hidden className="absolute top-[31px] bottom-0 left-[10px] w-[4px] bg-ink" />
            <dt className="text-lg font-semibold short:shrink-0 short:text-base">上車</dt>
            <dd className="min-w-0 text-drive font-bold break-words short:text-[36px]/[1.1]">{request.pickup_point.name}</dd>
          </div>
          <div className="relative pl-10 short:flex short:items-baseline short:gap-3">
            <span aria-hidden className="absolute top-0 left-[10px] h-[9px] w-[4px] bg-ink" />
            {/* The route strip's symbols, like the map: a stop is a filled circle, the destination a square (UD-29). */}
            <span
              aria-hidden
              data-symbol={atStop ? 'stop' : 'destination'}
              className={`absolute top-[8px] left-[1px] size-[22px] bg-ink ${atStop ? 'rounded-full' : 'rounded-[3px]'}`}
            />
            <dt className="text-lg font-semibold short:shrink-0 short:text-base">下車</dt>
            <dd className="min-w-0 text-drive font-bold break-words short:text-[36px]/[1.1]">{request.dropoff.name}</dd>
          </div>
        </dl>
        {/* One line of text with the pickup and drop-off, no action (DD-04, DD-43). */}
        <p className="mt-4 flex items-center gap-3 text-xl font-semibold short:mt-2">
          同企業乘客 <SimulatedBadge />
        </p>

        {others.length > 0 && <p className="mt-8 text-xl font-semibold short:mt-3">其他乘客在 {others.join('、')} 下車</p>}
        {offline && <ConnectionNote />}

        {/*
          Takes the space above the buttons, so they stay put with or without the map (UD-05). When
          that space is under 140px the map is left out, as when it cannot load (UD-29, T76).
        */}
        <div data-testid="request-map-slot" className="my-6 min-h-0 flex-1 [container:map-slot/size] short:my-3">
          <div data-testid="request-map" className="h-full overflow-hidden rounded-control map-cramped:hidden">
            <RequestMap tripId={tripId} request={request} />
          </div>
        </div>

        <div className="flex flex-col gap-5 pb-4 short:gap-3 short:pb-3">
          <button
            type="button"
            disabled={busy}
            onClick={onAccept}
            className="h-[112px] short:h-[88px] rounded-control bg-ink text-drive-button font-bold text-white active:bg-ink-soft disabled:opacity-60"
          >
            確認
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDecline}
            className="h-[72px] short:h-16 rounded-control text-2xl font-bold ring-[3px] ring-inset ring-ink active:bg-ink/10 disabled:opacity-60"
          >
            婉拒
          </button>
        </div>
      </main>
    </div>
  )
}
