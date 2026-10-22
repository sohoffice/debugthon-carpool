import { Button, type TripView } from '@carpool/shared'
import { ModeLabel } from './ModeLabel'
import { RoadSign } from './RoadSign'

/** One seat per place in the car, lit for each ride finished; more rides than seats light more (SC-D4). */
function Seats({ capacity, rides }: { capacity: number; rides: number }) {
  return (
    <span aria-hidden className="mt-5 flex flex-wrap gap-2.5">
      {Array.from({ length: Math.max(capacity, rides) }, (_, i) => (
        <span key={i} className={`h-[52px] w-11 rounded-t-[10px] rounded-b-[4px] border-4 border-route ${i < rides ? 'bg-route' : ''}`} />
      ))}
    </span>
  )
}

/** 6.4: shown once after the trip ended by itself at the destination (UD-16). No longer driving. */
export function TripEndedScreen({ trip, onDone }: { trip: TripView; onDone: () => void }) {
  return (
    <main className="ground-asphalt flex h-full flex-col bg-canvas px-6 pt-[calc(var(--safe-top)+28px)] pb-(--safe-bottom)">
      <ModeLabel>行程結束</ModeLabel>
      <RoadSign className="mt-7 px-7 pt-7 pb-7">
        <h1 className="text-xl font-semibold text-fg-soft">已到達目的地</h1>
        <p className="lettering-sign mt-2 text-[42px]/[1.15] font-semibold break-words">{trip.destination.name}</p>
        <p className="mt-4 border-t border-line pt-4 text-lg font-semibold text-fg-soft">從{trip.pickup_point.name}出發</p>
      </RoadSign>

      <p className="mt-12 text-[26px] font-semibold">{trip.completed_rides > 0 ? `這趟載了 ${trip.completed_rides} 位乘客` : '這趟沒有載到乘客'}</p>
      <Seats capacity={trip.capacity} rides={trip.completed_rides} />

      <Button className="mt-auto mb-4 h-[76px] w-full text-[28px]" onClick={onDone}>
        好
      </Button>
    </main>
  )
}
