import { ErrorNote } from '@carpool/shared'

export function LoadingScreen({ failed, missing }: { failed: boolean; missing?: string }) {
  return (
    <main className="flex h-full flex-col justify-center bg-white px-6">
      {missing ? (
        <ErrorNote>後端還沒有提供行程查詢（{missing}），正在重試。</ErrorNote>
      ) : failed ? (
        <ErrorNote>連不上伺服器，正在重試。</ErrorNote>
      ) : (
        <p className="text-lg text-ink-soft">載入中…</p>
      )}
    </main>
  )
}
