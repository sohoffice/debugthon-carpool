import { Button } from '@carpool/shared'

/** 7.7 no car: say so at once and give the way back; no alternatives in the PoC (REQ-036, REQ-051 out of scope, 8.5). */
export function NoMatchScreen({ onBack }: { onBack: () => void }) {
  return (
    <main className="flex h-full flex-col bg-paper px-6 pt-[calc(var(--safe-top)+24px)] pb-(--safe-bottom)">
      <h1 className="mt-16 text-[36px]/tight font-bold">目前沒有可搭的車</h1>
      <Button className="mt-auto mb-4 h-16 w-full text-xl" onClick={onBack}>
        回去看接近的車
      </Button>
    </main>
  )
}
