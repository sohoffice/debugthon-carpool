import { ErrorNote, RouteStripSkeleton } from '@carpool/shared'

/** Grey route strip instead of a blank screen while the trip loads (8.6). */
export function LoadingScreen({ failed, missing }: { failed: boolean; missing?: string }) {
  return (
    <main className="flex h-full flex-col bg-white px-6 pt-[calc(var(--safe-top)+40px)]">
      {missing ? (
        <ErrorNote>後端還沒有提供行程查詢（{missing}），正在重試。</ErrorNote>
      ) : failed ? (
        <ErrorNote>連不上伺服器，正在重試。</ErrorNote>
      ) : (
        <div aria-label="載入中">
          <RouteStripSkeleton rows={5} />
        </div>
      )}
    </main>
  )
}
