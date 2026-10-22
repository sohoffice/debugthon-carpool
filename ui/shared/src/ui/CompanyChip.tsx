import { SimulatedBadge } from './SimulatedBadge'

/**
 * The simulated 同企業 tag: looks selected but is plain text, so a tap changes nothing on screen or
 * in what is sent (REQ-062, REQ-063, DD-43).
 */
export function CompanyChip({ label }: { label: string }) {
  return (
    <p className="flex flex-wrap items-center gap-2">
      <span className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-base font-medium text-on-accent">{label}</span>
      <SimulatedBadge />
    </p>
  )
}
