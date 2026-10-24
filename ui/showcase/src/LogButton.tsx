import type { Ref } from 'react'

/** UD-30 part 2: the closed log, a quiet word; an 8px dot while an error is unseen. */
export function LogButton({ unseenError, onOpen, ref }: { unseenError: boolean; onOpen: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={false}
      aria-label={unseenError ? '紀錄，有新的錯誤' : undefined}
      onClick={onOpen}
      className="flex h-9 items-center text-base font-medium text-ink-soft hover:text-ink"
    >
      <span className="relative">
        紀錄
        {unseenError && <span aria-hidden data-testid="log-error-dot" className="absolute -top-0.5 -right-2.5 size-2 rounded-full bg-danger" />}
      </span>
    </button>
  )
}
