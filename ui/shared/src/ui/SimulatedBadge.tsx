/**
 * Marks simulated or estimated data (REQ-063). A dashed purple outline means "estimated, not
 * measured", the same everywhere (docs/ui-design.md P5, 8.3).
 */
export function SimulatedBadge({ label = '模擬' }: { label?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-[4px] border border-dashed border-simulated px-1.5 text-sm/[1.5] font-medium whitespace-nowrap text-simulated">
      {label}
    </span>
  )
}
