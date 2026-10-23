import { ArrivalBoard, BoardDashes } from './ArrivalBoard'
import { CancelButton } from './CancelButton'
import { StationSign } from './StationSign'

interface WaitingScreenProps {
  pickupName: string
  /** A driver declined or timed out and the request moved to the next car (REQ-050, REQ-053). */
  reassigned: boolean
  /** Just reassigned: say so for a moment before waiting for the next car (REQ-050). */
  declined: boolean
}

/**
 * 7.4 waiting: the board is up but has no car on it yet; the empty slots show what comes once a
 * driver confirms. The running light is the only ongoing motion on the site (8.4, P4).
 */
export function WaitingScreen({ pickupName, reassigned, declined }: WaitingScreenProps) {
  return (
    <main className="flex h-full flex-col bg-canvas pt-[calc(var(--safe-top)+16px)] pb-(--safe-bottom)">
      <StationSign name={pickupName} note="在這裡等" />
      <ArrivalBoard className="pt-7 pb-7">
        {declined ? (
          <>
            <h1 className="text-[34px]/tight font-semibold text-signal">駕駛無法載你</h1>
            <p className="mt-4 text-xl font-semibold text-fg-soft">正在改配下一台車…</p>
          </>
        ) : (
          <>
            <h1 className="text-[34px]/tight font-semibold">正在等駕駛確認</h1>
            <div aria-hidden className="mt-6 h-1.5 overflow-hidden bg-line">
              <span className="waiting-light block h-full w-1/4 bg-route" />
            </div>
          </>
        )}
        <div aria-hidden className="mt-8 flex items-end gap-5">
          <span className="flex h-[96px] items-end pb-3">
            <BoardDashes />
          </span>
          <span className="pb-2 text-xl font-semibold text-fg-soft">分鐘後到</span>
        </div>
        <div aria-hidden className="mt-5 flex items-center gap-4">
          <span className="h-11 w-[150px] rounded-plate border-[3px] border-dashed border-line" />
          <span className="text-lg text-fg-soft">車牌</span>
        </div>
      </ArrivalBoard>
      <p className="mt-5 px-6 text-lg text-fg-soft">駕駛確認後，這裡會顯示車牌和到達時間。</p>
      {reassigned && !declined && <p className="mx-6 mt-6 border-l-4 border-brand pl-3 text-lg font-semibold">上一位駕駛無法載你，已改配下一台車。</p>}
      <div className="mt-auto flex justify-end px-3 pb-4">
        <CancelButton />
      </div>
    </main>
  )
}
