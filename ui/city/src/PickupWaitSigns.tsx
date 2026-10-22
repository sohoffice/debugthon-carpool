import type { CityLive } from '@carpool/shared'

/** Station-name signs in the map's bottom left: who is waiting to be matched at each pickup point (REQ-078). */
export function PickupWaitSigns({ live }: { live: CityLive }) {
  return (
    <ul aria-label="各上車點等待配對" className="flex flex-wrap gap-2">
      {live.pickup_points.map((p) => (
        <li key={p.id} className="flex h-9 items-center overflow-hidden rounded-[6px] bg-brand pr-3 text-base font-bold whitespace-nowrap text-white shadow-md shadow-ink/30">
          <span className="mr-2 h-full w-1.5 bg-white/90" />
          {p.name}
          <span className="ml-2 font-medium">等待 {p.waiting}</span>
        </li>
      ))}
    </ul>
  )
}
