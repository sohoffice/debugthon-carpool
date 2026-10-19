import { Button, SimulatedBadge, type PassengerRequest } from '@carpool/shared'

/** 7.4 no car: say so at once and give the next step (REQ-036, REQ-051, 8.5). */
export function NoMatchScreen({ request, onBack }: { request: PassengerRequest; onBack: () => void }) {
  return (
    <main className="flex h-full flex-col bg-paper px-6 pt-[calc(var(--safe-top)+24px)] pb-(--safe-bottom)">
      <h1 className="text-[36px]/tight font-bold">目前沒有可搭的車</h1>
      <p className="mt-2 text-lg text-ink-soft">從{request.pickup_point.name}可以這樣去：</p>
      <ul aria-label="替代方案" className="mt-6 border-t border-rule">
        {request.alternatives.map((a, i) => (
          <li key={i} className="flex items-center gap-3 border-b border-rule py-4">
            <span className="flex h-8 min-w-14 shrink-0 items-center justify-center rounded-[6px] bg-ink px-2 text-base font-bold text-white">
              {a.mode === 'bus' ? a.route_name : '步行'}
            </span>
            <span className="min-w-0 flex-1 text-base">
              {a.mode === 'bus' ? `${a.board_stop_name}上車，${a.alight_stop_name}下車` : a.via ? `經${a.via}` : '走路到目的地'}
            </span>
            <span className="shrink-0 text-lg font-semibold tabular-nums">{a.duration_min} 分</span>
            {a.simulated && <SimulatedBadge label="估算" />}
          </li>
        ))}
      </ul>
      <Button className="mt-auto mb-4 h-16 w-full text-xl" onClick={onBack}>
        回去看接近的車
      </Button>
    </main>
  )
}
