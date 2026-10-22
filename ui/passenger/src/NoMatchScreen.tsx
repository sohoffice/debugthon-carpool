import { Button } from '@carpool/shared'
import { ArrivalBoard, BoardDashes } from './ArrivalBoard'
import { StationSign } from './StationSign'

/**
 * 7.7 no car: the board shows no arrival, said at once, with the way back; no alternatives in the
 * PoC (REQ-036, REQ-051 out of scope, 8.5).
 */
export function NoMatchScreen({ pickupName, onBack }: { pickupName: string; onBack: () => void }) {
  return (
    <main className="flex h-full flex-col bg-canvas pt-[calc(var(--safe-top)+16px)] pb-(--safe-bottom)">
      <StationSign name={pickupName} />
      <ArrivalBoard className="pt-7 pb-8">
        <div className="flex h-[96px] items-end pb-3">
          <BoardDashes />
        </div>
        <h1 className="mt-6 text-[34px]/tight font-semibold">目前沒有可搭的車</h1>
      </ArrivalBoard>
      <p className="mt-5 px-6 text-lg text-fg-soft">等一下再看看，或改搭其他交通工具。</p>
      <div className="mt-auto px-6 pb-4">
        <Button className="h-16 w-full text-xl" onClick={onBack}>
          回去看接近的車
        </Button>
      </div>
    </main>
  )
}
