import type { DriverRequestItem } from '@carpool/shared'
import { ConnectionNote } from './ConnectionNote'
import { ModeLabel } from './ModeLabel'
import { RoadSign } from './RoadSign'

interface TripIdleScreenProps {
  passengers: DriverRequestItem[]
  busy: boolean
  offline: boolean
  onBoarded: (requestId: number) => void
  onDropOff: (requestId: number) => void
}

function PassengerSign({ passenger, busy, onBoarded, onDropOff }: { passenger: DriverRequestItem } & Omit<TripIdleScreenProps, 'passengers' | 'offline'>) {
  const name = passenger.dropoff.name
  // One button per passenger: first "上車", then "下車" (DD-27, DD-23).
  const action = passenger.boarded
    ? { label: '已下車', aria: `${name}的乘客已下車`, run: () => onDropOff(passenger.id) }
    : { label: '已上車', aria: `${name}的乘客已上車`, run: () => onBoarded(passenger.id) }
  return (
    <li>
      <RoadSign className="px-6 pt-5 pb-5">
        <p className="lettering-sign text-[28px]/tight font-semibold break-words">
          {name}
          <span className="ml-2 text-xl text-fg-soft">下車</span>
        </p>
        <div className="mt-3 flex items-center gap-3">
          {/* Open ring: waiting at the pickup; filled: in the car. The words say the same. */}
          <span aria-hidden className={`size-6 shrink-0 rounded-full border-[6px] border-route ${passenger.boarded ? 'bg-route' : ''}`} />
          <span className="flex-1 text-xl font-semibold text-fg-soft">{passenger.boarded ? '在車上' : '等上車'}</span>
          <button
            type="button"
            disabled={busy}
            aria-label={action.aria}
            onClick={action.run}
            className="h-[68px] w-[160px] shrink-0 rounded-sign-button bg-action text-[26px] font-semibold text-on-action active:bg-action-down disabled:opacity-50"
          >
            {action.label}
          </button>
        </div>
      </RoadSign>
    </li>
  )
}

/** 6.2: asphalt screen, one question answered. No map, stats, hints or animation (DD-04, REQ-066). */
export function TripIdleScreen({ passengers, busy, offline, onBoarded, onDropOff }: TripIdleScreenProps) {
  return (
    <main className="ground-asphalt flex h-full flex-col bg-canvas px-6 pt-[calc(var(--safe-top)+28px)] pb-(--safe-bottom)">
      <ModeLabel>行程中</ModeLabel>
      <h1 className="lettering-sign mt-6 text-drive-status font-semibold tracking-wide">
        目前沒有
        <br />
        搭車請求
      </h1>
      {offline && <ConnectionNote />}

      {passengers.length > 0 && (
        <section aria-label="乘客" className="mt-auto -mx-6 min-h-0 overflow-y-auto px-6 pt-6 pb-4">
          <h2 className="sr-only">乘客</h2>
          <ul className="flex flex-col gap-3">
            {passengers.map((p) => (
              <PassengerSign key={p.id} passenger={p} busy={busy} onBoarded={onBoarded} onDropOff={onDropOff} />
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
