import { ErrorNote } from '@carpool/shared'
import { ArrivalBoard, BoardDashes } from './ArrivalBoard'

/** An unlit station sign over an empty arrival board, instead of a blank screen (8.6, UD-21). */
export function LoadingScreen({ failed, missing }: { failed: boolean; missing?: string }) {
  return (
    <main className="flex h-full flex-col bg-canvas pt-[calc(var(--safe-top)+16px)]">
      <div className="flex h-[72px] items-center bg-brand-soft">
        <span aria-hidden className="ml-6 w-3.5 self-stretch bg-white" />
        <span aria-hidden className="ml-4 h-6 w-36 rounded-full bg-white/70" />
      </div>
      <ArrivalBoard className="pt-7 pb-8">
        {missing ? (
          <ErrorNote>後端還沒有提供乘客需要的功能（{missing}），正在重試。</ErrorNote>
        ) : failed ? (
          <ErrorNote>連不上伺服器，正在重試。</ErrorNote>
        ) : (
          <div role="status" aria-label="載入中" className="flex h-[96px] items-end pb-3">
            <BoardDashes />
          </div>
        )}
      </ArrivalBoard>
    </main>
  )
}
