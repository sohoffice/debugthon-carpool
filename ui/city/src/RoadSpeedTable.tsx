import { SimulatedBadge, type CityRoad, type CityTraffic } from '@carpool/shared'
import { slotLabel } from './format'
import { slotTime } from './trafficSlots'

/** 20% or more slower than the same time over the past 10 workdays (REQ-079, UD-26); a missing side is not slow. */
export function isSlow(road: CityRoad): boolean {
  return road.avg_speed_kmh !== null && road.past_avg_speed_kmh !== null && road.avg_speed_kmh <= road.past_avg_speed_kmh * 0.8
}

const kmh = (v: number | null) => (v === null ? '—' : `${Math.round(v)} km/h`)

/** The main roads' speed in the shown slot next to the past 10 workdays at the same time (REQ-079). */
export function RoadSpeedTable({ traffic, today }: { traffic: CityTraffic; today: string }) {
  const slotDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(traffic.slot_start))
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
        主要道路車速 {slotDate !== today && `${Number(slotDate.slice(5, 7))}/${Number(slotDate.slice(8, 10))} `}
        {slotLabel(slotTime(traffic.slot_start))}
        {traffic.simulated && <SimulatedBadge />}
      </h3>
      <table className="mt-1 w-full text-sm">
        <thead>
          <tr className="text-left text-ink-soft">
            <th className="py-1 font-medium">道路</th>
            <th className="py-1 text-right font-medium">此時段</th>
            <th className="py-1 text-right font-medium">過去 10 個上班日同時段</th>
          </tr>
        </thead>
        <tbody>
          {traffic.roads.map((r) => (
            <tr key={r.road_name} className={`border-t border-rule ${isSlow(r) ? 'font-bold text-danger' : ''}`}>
              <td className="py-1">{r.road_name}</td>
              <td className="py-1 text-right tabular-nums">{kmh(r.avg_speed_kmh)}</td>
              <td className="py-1 text-right tabular-nums">{kmh(r.past_avg_speed_kmh)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
