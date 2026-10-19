import type { DriverTrip } from '@carpool/shared'

/** 6.4: shown once after the trip ended by itself at the destination (UD-16). No longer driving. */
export function TripEndedScreen({ trip, onDone }: { trip: DriverTrip; onDone: () => void }) {
  return (
    <main className="flex h-full flex-col bg-ink px-6 pt-(--safe-top) pb-(--safe-bottom) text-white">
      <p className="mt-6 text-lg font-semibold text-white/60">行程結束</p>
      <h1 className="mt-6 text-drive font-bold">已到達目的地</h1>
      <p className="mt-2 text-[28px]/tight font-semibold text-white/80">{trip.destination.name}</p>
      <p className="mt-12 text-2xl font-semibold">{trip.completed_count > 0 ? `今天載了 ${trip.completed_count} 位乘客` : '這趟沒有載到乘客'}</p>
      <button
        type="button"
        onClick={onDone}
        className="mt-auto mb-4 h-16 rounded-control bg-white text-xl font-bold text-ink active:bg-paper"
      >
        好
      </button>
    </main>
  )
}
