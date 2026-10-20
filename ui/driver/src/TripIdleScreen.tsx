import type { DriverRequestItem } from '@carpool/shared'
import { ConnectionNote } from './ConnectionNote'

interface TripIdleScreenProps {
  passengers: DriverRequestItem[]
  busy: boolean
  offline: boolean
  onBoarded: (requestId: number) => void
  onDropOff: (requestId: number) => void
}

function PassengerRow({ passenger, busy, onBoarded, onDropOff }: { passenger: DriverRequestItem } & Omit<TripIdleScreenProps, 'passengers' | 'offline'>) {
  const name = passenger.dropoff.name
  // One button per passenger: first "上車", then "下車" (DD-27, DD-23).
  const action = passenger.boarded
    ? { label: '已下車', aria: `${name}的乘客已下車`, run: () => onDropOff(passenger.id) }
    : { label: '已上車', aria: `${name}的乘客已上車`, run: () => onBoarded(passenger.id) }
  return (
    <li className="flex items-center justify-between gap-4 border-b border-white/20 py-3">
      <span className="min-w-0">
        <span className="block text-[26px]/tight font-bold">{name} 下車</span>
        <span className="mt-1 block text-lg font-semibold text-white/60">{passenger.boarded ? '在車上' : '等上車'}</span>
      </span>
      <button
        type="button"
        disabled={busy}
        aria-label={action.aria}
        onClick={action.run}
        className="h-16 shrink-0 rounded-control px-6 text-xl font-bold ring-2 ring-inset ring-white/80 active:bg-white/15 disabled:opacity-50"
      >
        {action.label}
      </button>
    </li>
  )
}

/** 6.2: asphalt screen, one question answered. No map, stats, hints or animation (DD-04, REQ-066). */
export function TripIdleScreen({ passengers, busy, offline, onBoarded, onDropOff }: TripIdleScreenProps) {
  return (
    <main className="flex h-full flex-col bg-ink px-6 pt-(--safe-top) pb-(--safe-bottom) text-white">
      <p className="mt-6 text-lg font-semibold text-white/60">行程中</p>
      <h1 className="mt-6 text-drive font-bold">
        目前沒有
        <br />
        搭車請求
      </h1>
      {offline && <ConnectionNote />}

      {passengers.length > 0 && (
        <section aria-label="乘客" className="mt-auto pb-6">
          <h2 className="text-lg font-semibold text-white/60">乘客</h2>
          <ul className="mt-3 border-t border-white/20">
            {passengers.map((p) => (
              <PassengerRow key={p.id} passenger={p} busy={busy} onBoarded={onBoarded} onDropOff={onDropOff} />
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
