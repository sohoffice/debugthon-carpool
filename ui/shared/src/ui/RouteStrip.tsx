import type { RouteStripItem, RouteStripKind } from './routeStripItems'

const ROW_CLASS: Record<RouteStripKind, string> = {
  pickup: 'h-11 text-lg font-semibold',
  stop: 'h-9 text-base text-fg-soft',
  dropoff: 'h-11 text-lg font-semibold',
  destination: 'h-11 text-lg font-semibold',
}

function Symbol({ kind }: { kind: RouteStripKind }) {
  if (kind === 'pickup') return <span className="size-5 rounded-full border-[4px] border-route bg-canvas" />
  if (kind === 'stop') return <span className="size-3 rounded-full border-[2.5px] border-route bg-canvas" />
  if (kind === 'dropoff') return <span className="size-5 rounded-full border-[4px] border-route bg-route" />
  return <span className="size-[18px] rounded-[3px] bg-route" />
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
            {i > 0 && <span className="absolute top-0 bottom-1/2 w-[6px] bg-route" />}
            {i < items.length - 1 && <span className="absolute top-1/2 bottom-0 w-[6px] bg-route" />}
            <span className="relative flex items-center justify-center">
              <Symbol kind={item.kind} />
            </span>
          </span>
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          {item.note && <span className="shrink-0 text-sm font-semibold text-fg-soft">{item.note}</span>}
        </li>
      ))}
    </ol>
  )
}

/** The route strip in outline, shown while the route loads instead of a blank space (8.6). */
export function RouteStripSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden className="motion-safe:animate-pulse">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="relative flex h-10 items-center gap-4">
          <span className="relative flex w-5 shrink-0 items-center justify-center self-stretch">
            {i > 0 && <span className="absolute top-0 bottom-1/2 w-[6px] bg-line" />}
            {i < rows - 1 && <span className="absolute top-1/2 bottom-0 w-[6px] bg-line" />}
            <span className={`relative rounded-full bg-line ${i === 0 || i === rows - 1 ? 'size-5' : 'size-3'}`} />
          </span>
          <span className="h-4 rounded-full bg-line" style={{ width: `${[56, 40, 48, 64][i % 4]}%` }} />
        </div>
      ))}
    </div>
  )
}
