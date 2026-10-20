import { Button } from '@carpool/shared'

/** Rejected or completed: one title, one sentence, one button (7.4). */
export function ResultScreen({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }) {
  return (
    <main className="flex h-full flex-col bg-paper px-6 pt-[calc(var(--safe-top)+24px)] pb-(--safe-bottom)">
      <h1 className="mt-16 text-[36px]/tight font-bold">{title}</h1>
      <p className="mt-3 text-xl text-ink-soft">{text}</p>
      <Button className="mt-auto mb-4 h-16 w-full text-xl" onClick={onAction}>
        {action}
      </Button>
    </main>
  )
}
