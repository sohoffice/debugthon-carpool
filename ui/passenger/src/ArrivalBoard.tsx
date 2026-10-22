import type { ReactNode } from 'react'

/** The dark arrival board under a station sign; the passenger's screens hang off it (UD-21). */
export function ArrivalBoard({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`ground-asphalt bg-ink px-6 ${className}`}>{children}</div>
}

/** Dashes where the minutes will be, like a board with no arrival yet. */
export function BoardDashes() {
  return (
    <span aria-hidden className="flex gap-2">
      <span className="h-3 w-12 bg-line" />
      <span className="h-3 w-12 bg-line" />
    </span>
  )
}
