import { ErrorNote, SimulatedBadge } from '@carpool/shared'
import type { ReactNode } from 'react'

interface PanelProps {
  /** The region's accessible name. */
  name: string
  /** Small category line, e.g. 今天的請求. */
  kicker: string
  /** Data marks after the kicker (REQ-063): 模擬, 含模擬, 估算. */
  marks?: (string | false | undefined)[]
  /** One line that states the conclusion (UD-27); absent until data arrives. */
  title?: string
  /** Shown above the content when this area's last poll failed; the last data stays (SC-C1). */
  error?: string | false
  className?: string
  children?: ReactNode
}

/** A white war-room panel: kicker with data marks, then a headline that says the conclusion (UD-27). */
export function Panel({ name, kicker, marks = [], title, error, className = '', children }: PanelProps) {
  return (
    <section aria-label={name} className={`flex min-h-0 min-w-0 flex-col rounded-[8px] border border-rule bg-white px-4 pt-3 pb-3.5 ${className}`}>
      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-soft">
        {kicker}
        {marks.filter((m): m is string => !!m).map((m) => (
          <SimulatedBadge key={m} label={m} />
        ))}
      </p>
      {title && <h2 className="mt-0.5 mb-2 text-lg/snug font-semibold text-ink">{title}</h2>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {children}
    </section>
  )
}
