import { ErrorNote, RouteStripSkeleton } from '@carpool/shared'

/** Grey route strip instead of a blank screen (8.6). */
export function LoadingScreen({ failed }: { failed: boolean }) {
  return (
    <main className="flex h-full flex-col bg-paper px-6 pt-[calc(var(--safe-top)+40px)]">
      {failed ? <ErrorNote>連不上伺服器，正在重試。</ErrorNote> : <RouteStripSkeleton rows={5} />}
    </main>
  )
}
