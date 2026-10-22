import type { ReactNode } from 'react'

/** A bottom sheet over the commute screen (24px corners, 8.3); the scrim closes it. */
export function CommuteSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <button type="button" aria-label="關閉" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-asphalt-sunk/60" />
      <section
        role="dialog"
        aria-label={title}
        className="relative max-h-[86%] overflow-y-auto overscroll-contain rounded-t-sheet bg-canvas px-6 pt-6 pb-[calc(var(--safe-bottom)+12px)]"
      >
        <h2 className="text-[24px]/tight font-semibold">{title}</h2>
        {children}
      </section>
    </div>
  )
}
