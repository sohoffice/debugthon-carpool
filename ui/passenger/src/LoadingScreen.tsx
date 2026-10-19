import { ErrorNote, RouteStripSkeleton } from '@carpool/shared'

/** Grey route strip instead of a blank screen (8.6). */
export function LoadingScreen({ failed, missing }: { failed: boolean; missing?: string }) {
  return (
    <main className="flex h-full flex-col bg-paper px-6 pt-[calc(var(--safe-top)+40px)]">
      {missing ? (
        <ErrorNote>後端還沒有提供乘客需要的功能（{missing}），正在重試。</ErrorNote>
      ) : failed ? (
        <ErrorNote>連不上伺服器，正在重試。</ErrorNote>
      ) : (
        <RouteStripSkeleton rows={5} />
      )}
    </main>
  )
}
