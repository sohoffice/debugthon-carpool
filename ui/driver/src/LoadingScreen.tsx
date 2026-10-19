import { ErrorNote } from '@carpool/shared'

export function LoadingScreen({ failed }: { failed: boolean }) {
  return (
    <main className="flex h-full flex-col justify-center bg-white px-6">
      {failed ? <ErrorNote>連不上伺服器，正在重試。</ErrorNote> : <p className="text-lg text-ink-soft">載入中…</p>}
    </main>
  )
}
