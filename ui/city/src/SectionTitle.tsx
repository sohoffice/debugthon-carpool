import { SimulatedBadge } from '@carpool/shared'
import type { ReactNode } from 'react'

/** An area's title; `mark` labels simulated data in it (REQ-063): 含模擬 when mixed with real data. */
export function SectionTitle({ children, mark }: { children: ReactNode; mark?: string | false }) {
  return (
    <h2 className="flex items-center gap-2 text-base font-bold text-ink">
      {children}
      {mark && <SimulatedBadge label={mark} />}
    </h2>
  )
}
