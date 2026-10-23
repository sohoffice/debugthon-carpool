import { SimulatedBadge, type CityClock } from '@carpool/shared'
import { clockTime, monthDay, weekdayOf } from './format'

/** Board-ink bar; date, time and the Demo clock mark all come from the API (DD-41, UD-26). */
export function TopBar({ clock }: { clock: CityClock | undefined }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between bg-ink px-6 text-white [--color-sim:var(--color-simulated-light)]">
      <h1 className="flex items-center gap-3 text-lg font-bold">
        <span className="h-6 w-1.5 bg-brand-glow" />
        內科順路共乘　市府管理
      </h1>
      {clock && (
        <div className="flex items-center gap-4 text-base font-medium">
          <span>
            {monthDay(clock.today)} 星期{weekdayOf(clock.today)}
          </span>
          <span className="tabular-nums">現在 {clockTime(clock.now)}</span>
          {clock.demo_clock && <SimulatedBadge label="模擬時間" />}
        </div>
      )}
    </header>
  )
}
