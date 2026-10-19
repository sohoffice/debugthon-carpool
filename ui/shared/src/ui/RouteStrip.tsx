import type { RouteStripItem, RouteStripKind } from './routeStripItems'

const ROW_CLASS: Record<RouteStripKind, string> = {
  pickup: 'h-11 text-lg font-semibold',
  stop: 'h-9 text-base text-ink-soft',
  dropoff: 'h-11 text-lg font-semibold',
  destination: 'h-11 text-lg font-semibold',
}

function Symbol({ kind }: { kind: RouteStripKind }) {
  if (kind === 'pickup') return <span className="size-5 rounded-full border-[3.5px] border-brand bg-white" />
  if (kind === 'stop') return <span className="size-3 rounded-full border-[2.5px] border-brand bg-white" />
  if (kind === 'dropoff') return <span className="size-5 rounded-full border-[3.5px] border-brand bg-brand" />
  return <span className="size-[18px] rounded-[3px] bg-brand" />
}

/**
 * Vertical line map like the one in an MRT car: pickup (open ring) → bus stops (small rings)
 * → passenger's stop (filled) → destination (square), joined by the route colour (UD-01, 8.3).
 */
export function RouteStrip({ items, label = '今天的路線' }: { items: RouteStripItem[]; label?: string }) {
  return (
    <ol aria-label={label} className="relative">
      {items.map((item, i) => (
        <li key={item.key} className={`relative flex items-center gap-4 ${ROW_CLASS[item.kind]}`}>
          <span aria-hidden className="relative flex w-5 shrink-0 items-center justify-center self-stretch">
            {i > 0 && <span className="absolute top-0 bottom-1/2 w-[5px] bg-brand" />}
            {i < items.length - 1 && <span className="absolute top-1/2 bottom-0 w-[5px] bg-brand" />}
            <span className="relative flex items-center justify-center">
              <Symbol kind={item.kind} />
            </span>
          </span>
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          {item.note && <span className="shrink-0 text-sm font-semibold text-ink-soft">{item.note}</span>}
        </li>
      ))}
    </ol>
  )
}
