/**
 * Marks simulated or estimated data (REQ-063). A dashed purple outline means "estimated, not
 * measured", the same shape and words everywhere; on a dark ground the purple is lighter so it
 * stays readable (docs/ui-design.md P5, 8.3, UD-21).
 */
export function SimulatedBadge({ label = '模擬' }: { label?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-[4px] border border-dashed border-sim px-1.5 text-sm/[1.5] font-medium whitespace-nowrap text-sim">
      {label}
    </span>
  )
}
