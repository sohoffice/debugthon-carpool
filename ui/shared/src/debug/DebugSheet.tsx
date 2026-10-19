import { useState, type ReactNode } from 'react'
import { SimulatedBadge } from '../ui/SimulatedBadge'

/**
 * Debug mode frame: a small dashed "除錯" button over the screen that opens a full sheet.
 * The content keeps running while the sheet is closed. Marked as simulated (REQ-063).
 */
export function DebugSheet({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {!open && (
        // A narrow tab on the left edge, inside the screen's side margin, so it never covers its buttons.
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute top-1/2 left-0 z-30 -translate-y-1/2 rounded-r-[8px] border border-l-0 border-dashed border-simulated bg-white/95 px-0.5 py-2 text-sm font-semibold text-simulated [writing-mode:vertical-rl]"
        >
          除錯
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label="除錯模式"
          className="absolute inset-0 z-40 overflow-y-auto overscroll-contain bg-white px-6 pt-[calc(var(--safe-top)+16px)] pb-[calc(var(--safe-bottom)+24px)] text-ink"
        >
          <div className="flex items-center gap-3">
            <h1 className="text-[28px]/tight font-bold">除錯模式</h1>
            <SimulatedBadge label="Demo 工具" />
            <button type="button" onClick={() => setOpen(false)} className="ml-auto h-11 rounded-control px-4 text-lg font-semibold ring-1 ring-inset ring-rule">
              關閉
            </button>
          </div>
          {children}
        </section>
      )}
    </>
  )
}
