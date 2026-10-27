import { Button, Plate, type Vehicle } from '@carpool/shared'

interface CompletedScreenProps {
  pickupName: string
  /** Null when the ride is shown after a reload and the stop is not known. */
  dropoffName: string | null
  vehicle: Vehicle | null
  /** From boarded_at to completed_at; null when the passenger never marked boarding. */
  rideMinutes: number | null
  onDone: () => void
}

/** Whole minutes in the car, from the two times the backend recorded (no clock time: the status bar is fixed at 08:12). */
export function rideMinutesOf(boardedAt: string | null, completedAt: string | null): number | null {
  if (!boardedAt || !completedAt) return null
  const ms = Date.parse(completedAt) - Date.parse(boardedAt)
  return Number.isFinite(ms) && ms >= 0 ? Math.max(1, Math.round(ms / 60000)) : null
}

/**
 * 7.9 the demo's last scene: the station sign's white bar runs down into the ride's own line
 * map, pickup to drop-off, with the car that took the passenger (UD-22). 回到首頁 stays at the
 * bottom; on a short screen only the content above it scrolls (T77).
 */
export function CompletedScreen({ pickupName, dropoffName, vehicle, rideMinutes, onDone }: CompletedScreenProps) {
  return (
    <main className="relative flex h-full flex-col bg-canvas pt-(--safe-top) pb-(--safe-bottom)">
      {/* The ride scrolls here when the screen is too short, never the screen itself (REQ-055, T77). */}
      <div data-testid="completed-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* Below the status bar: its dark text stays on white (the passenger's status bar is always dark). */}
        <header className="relative bg-brand pt-14 pr-6 pb-9 pl-[62px] text-white">
          <span aria-hidden className="absolute top-0 bottom-0 left-6 w-3.5 bg-white" />
          <h1 className="text-[48px]/[1.1] font-semibold">共乘完成</h1>
          <p className="mt-2 text-lg text-brand-soft">這趟共乘已記錄。</p>
        </header>

        <ol aria-label="這趟共乘" className="relative px-6 pt-9">
          {/* The station sign's bar carries on as the line, down to the drop-off. */}
          <span aria-hidden className="absolute top-0 bottom-8 left-6 w-3.5 bg-brand" />
          <li className="relative flex h-16 items-center gap-5">
            <span aria-hidden className="relative -ml-[13px] size-10 shrink-0 rounded-full border-8 border-brand bg-white" />
            <span>
              <span className="block text-base font-semibold text-fg-soft">上車</span>
              <span className="block text-[30px]/tight font-semibold">{pickupName}</span>
            </span>
          </li>
          <li className="flex h-[120px] items-center pl-10 text-lg font-semibold text-fg-soft">{rideMinutes !== null && `車上 ${rideMinutes} 分鐘`}</li>
          <li className="relative flex h-16 items-center gap-5">
            <span aria-hidden className="relative -ml-[13px] size-10 shrink-0 rounded-full border-8 border-brand bg-brand" />
            <span>
              <span className="block text-base font-semibold text-fg-soft">下車</span>
              <span className="block text-[30px]/tight font-semibold">{dropoffName ?? '已下車'}</span>
            </span>
          </li>
        </ol>

        {vehicle && (
          <div className="mx-6 mt-11 flex items-center gap-4 border-t border-line pt-6">
            <Plate plate={vehicle.plate} />
            <span className="min-w-0 text-lg">{vehicle.description}</span>
          </div>
        )}
      </div>

      <div className="shrink-0 px-6 pt-4 pb-4">
        <Button className="h-16 w-full text-xl" onClick={onDone}>
          回到首頁
        </Button>
      </div>
    </main>
  )
}
