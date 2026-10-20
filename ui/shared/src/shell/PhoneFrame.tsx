import type { ReactNode } from 'react'
import { BEZEL, FRAME_HEIGHT, FRAME_WIDTH } from './device'

/**
 * Generic phone body (rounded body, thin edge, no brand look-alike) around a 390×844 screen.
 * Also used by the showcase page around an iframe (UD-13, UD-18).
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative rounded-[60px] bg-ink shadow-2xl shadow-ink/30 ring-1 ring-ink-soft/60"
      style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, padding: BEZEL }}
    >
      {/* Side keys */}
      <span aria-hidden className="absolute top-[180px] -left-[3px] h-[56px] w-[3px] rounded-l bg-ink" />
      <span aria-hidden className="absolute top-[250px] -left-[3px] h-[56px] w-[3px] rounded-l bg-ink" />
      <span aria-hidden className="absolute top-[220px] -right-[3px] h-[88px] w-[3px] rounded-r bg-ink" />
      {/* translateZ makes the screen the containing block for fixed-position children. */}
      <div className="relative h-full w-full overflow-hidden rounded-[48px] bg-ink [transform:translateZ(0)]">
        {children}
        <span aria-hidden className="absolute top-[14px] left-1/2 z-50 size-[12px] -translate-x-1/2 rounded-full bg-ink" />
      </div>
    </div>
  )
}
