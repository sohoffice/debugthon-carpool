import type { SupplyVehicle } from '@carpool/shared'
import { minutesOf } from './search'

interface ArrivalTimelineProps {
  vehicles: SupplyVehicle[]
  /** The timeline spans now to the wait limit (REQ-030). */
  waitLimitMin: number
}

/**
 * Cars approaching the pickup point on a line from now to the wait limit. The dots slide to their
 * new place after each poll; they are not buttons (REQ-031).
 */
export function ArrivalTimeline({ vehicles, waitLimitMin }: ArrivalTimelineProps) {
  const limitS = waitLimitMin * 60
  const summary = vehicles.length ? `接近中的車：${vehicles.map((v) => minutesOf(v.eta_s)).join('、')} 分鐘後到` : '目前沒有接近中的車'
  return (
    <figure className="px-6">
      <figcaption className="sr-only">{summary}</figcaption>
      <div aria-hidden className="relative h-16">
        <span className="absolute top-10 right-0 left-0 h-[6px] rounded-full bg-brand-soft" />
        <span className="absolute top-8 left-0 h-[22px] w-[3px] rounded-full bg-ink" />
        <span className="absolute top-8 right-0 h-[22px] w-[3px] rounded-full bg-rule" />
        {vehicles.map((v) => {
          const left = `${(Math.min(v.eta_s, limitS) / limitS) * 100}%`
          return (
            <span
              key={v.id}
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center transition-[left] duration-[2400ms] ease-linear motion-reduce:transition-none"
              style={{ left }}
            >
              <span className="font-board text-xl font-semibold tabular-nums">{minutesOf(v.eta_s)}</span>
              <span className="mt-1 size-[18px] rounded-full border-[3px] border-white bg-brand shadow" />
            </span>
          )
        })}
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-sm font-semibold text-ink-soft">
        <span>現在</span>
        <span>{waitLimitMin} 分</span>
      </div>
    </figure>
  )
}
