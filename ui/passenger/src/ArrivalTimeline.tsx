import type { SupplyCar } from '@carpool/shared'
import { minutesOf } from './search'

interface ArrivalTimelineProps {
  cars: SupplyCar[]
  /** The timeline spans now to the wait limit (REQ-030). */
  rangeS: number
}

/**
 * Cars approaching the pickup point on a line from now to the wait limit, drawn on the arrival
 * board. The dots slide to their new place after each poll; they are not buttons (REQ-031).
 */
export function ArrivalTimeline({ cars, rangeS }: ArrivalTimelineProps) {
  const minutes = (c: SupplyCar) => `${minutesOf(c.eta_s)}${c.eta_simulated ? '（估算）' : ''}`
  const summary = cars.length ? `接近中的車：${cars.map(minutes).join('、')} 分鐘後到` : '目前沒有接近中的車'
  return (
    <figure>
      <figcaption className="sr-only">{summary}</figcaption>
      <div aria-hidden className="relative mx-2 h-16">
        <span className="absolute top-10 right-0 left-0 h-1 bg-line" />
        <span className="absolute top-8 left-0 h-5 w-[3px] bg-fg" />
        <span className="absolute top-8 right-0 h-5 w-[3px] bg-line" />
        {cars.map((c) => {
          const left = `${(Math.min(c.eta_s, rangeS) / rangeS) * 100}%`
          return (
            <span
              // The trip id stays the same while the car approaches, so the dot slides.
              key={c.trip_id}
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center transition-[left] duration-[2400ms] ease-linear motion-reduce:transition-none"
              style={{ left }}
            >
              {/* A simulated ETA gets the simulated outline, the same as SimulatedBadge (REQ-063, 8.3). */}
              <span className={`text-xl/[1.3] digits-board font-bold ${c.eta_simulated ? 'rounded-[4px] border border-dashed border-sim px-1 text-sim' : ''}`}>
                {minutesOf(c.eta_s)}
              </span>
              <span className="mt-1 size-[18px] rounded-full border-[3px] border-canvas bg-route" />
            </span>
          )
        })}
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-sm font-semibold text-fg-soft">
        <span>現在</span>
        <span>{Math.round(rangeS / 60)} 分</span>
      </div>
    </figure>
  )
}
