import type { ReactNode } from 'react'

interface SettingRowProps {
  label: string
  /** Current value, shown while collapsed (UD-02). */
  value: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}

/** A collapsible setting: label and current value; tap to edit in place. */
export function SettingRow({ label, value, open, onToggle, children }: SettingRowProps) {
  return (
    <div className="border-b border-line">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex h-14 w-full items-center gap-4 text-left">
        <span className="shrink-0 text-base text-fg-soft">{label}</span>
        <span className="min-w-0 flex-1 truncate text-right text-[17px] font-semibold">{value}</span>
        <svg aria-hidden width="10" height="16" viewBox="0 0 10 16" className={`shrink-0 text-fg-soft ${open ? 'rotate-90' : ''}`}>
          <path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  )
}

/** A setting edited right in the row (stepper, switch). */
export function SettingLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-14 items-center justify-between gap-4 border-b border-line">
      <span className="text-base text-fg-soft">{label}</span>
      {children}
    </div>
  )
}
