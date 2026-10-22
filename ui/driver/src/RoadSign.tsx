import type { ReactNode } from 'react'

/**
 * A road sign's face: a plate with an inset white border, like the guide signs over the road.
 * The driver's grouping device; one sign holds one thing to read at a glance (UD-21).
 */
export function RoadSign({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-sign bg-surface outline-[3px] -outline-offset-[9px] outline-white/90 ${className}`}>{children}</div>
}
