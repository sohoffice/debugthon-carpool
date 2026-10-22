import { ErrorNote } from '@carpool/shared'
import { ModeLabel } from './ModeLabel'
import { RoadSign } from './RoadSign'

/** Asphalt from the first frame, with an empty road sign where the trip will be (8.6, UD-21). */
export function LoadingScreen({ failed, missing }: { failed: boolean; missing?: string }) {
  return (
    <main className="ground-asphalt flex h-full flex-col bg-canvas px-6 pt-[calc(var(--safe-top)+28px)]">
      <ModeLabel>{failed ? '連線中斷' : '讀取行程'}</ModeLabel>
      <div className="mt-7">
        {missing ? (
          <ErrorNote>後端還沒有提供行程查詢（{missing}），正在重試。</ErrorNote>
        ) : failed ? (
          <ErrorNote>連不上伺服器，正在重試。</ErrorNote>
        ) : (
          <RoadSign className="px-7 pt-8 pb-8">
            <div aria-label="載入中" role="status">
              <span className="block h-5 w-2/5 rounded-full bg-line" />
              <span className="mt-5 block h-9 w-4/5 rounded-full bg-line" />
            </div>
          </RoadSign>
        )}
      </div>
    </main>
  )
}
