import type { DriverTrip } from '@carpool/shared'
import { ConnectionNote } from './ConnectionNote'

interface TripIdleScreenProps {
  trip: DriverTrip
  busy: boolean
  offline: boolean
  onDropOff: (requestId: number) => void
}

/** 6.2: asphalt screen, one question answered. No map, stats, hints or animation (DD-04, REQ-066). */
export function TripIdleScreen({ trip, busy, offline, onDropOff }: TripIdleScreenProps) {
  return (
    <main className="flex h-full flex-col bg-ink px-6 pt-(--safe-top) pb-(--safe-bottom) text-white">
      <p className="mt-6 text-lg font-semibold text-white/60">行程中</p>
      <h1 className="mt-6 text-drive font-bold">
        目前沒有
        <br />
        搭車請求
      </h1>
      {offline && <ConnectionNote />}

      {trip.passengers.length > 0 && (
        <section aria-label="車上乘客" className="mt-auto pb-6">
          <h2 className="text-lg font-semibold text-white/60">車上乘客</h2>
          <ul className="mt-3 border-t border-white/20">
            {trip.passengers.map((p) => (
              <li key={p.request_id} className="flex items-center justify-between gap-4 border-b border-white/20 py-3">
                <span className="min-w-0 text-[26px]/tight font-bold">{p.dropoff.name} 下車</span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`${p.dropoff.name}的乘客已下車`}
                  onClick={() => onDropOff(p.request_id)}
                  className="h-16 shrink-0 rounded-control px-6 text-xl font-bold ring-2 ring-inset ring-white/80 active:bg-white/15 disabled:opacity-50"
                >
                  已下車
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
