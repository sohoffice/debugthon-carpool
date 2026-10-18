/** Marks simulated data on screen (REQ-063: real vs simulated must be visible). */
export function SimulatedBadge({ label = '模擬' }: { label?: string }) {
  return <span className="rounded bg-simulated/15 px-1.5 py-0.5 text-xs font-medium text-simulated">{label}</span>
}
