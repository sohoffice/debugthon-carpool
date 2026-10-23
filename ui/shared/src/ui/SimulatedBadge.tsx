/**
 * Marks simulated or estimated data (REQ-063). A dashed purple outline means "estimated, not
 * measured", the same shape and words everywhere; on a dark ground the purple is lighter so it
 * stays readable (docs/ui-design.md P5, 8.3, UD-21). `size="row"` fits an 18px heat grid row
 * (SC-X4, UD-25): smaller type, the same shape and words.
 */
export function SimulatedBadge({ label = '模擬', size = 'default' }: { label?: string; size?: 'default' | 'row' }) {
  const type = size === 'row' ? 'px-1 text-[11px]/[14px]' : 'px-1.5 text-sm/[1.5]'
  return (
    <span className={`inline-flex shrink-0 items-center rounded-[4px] border border-dashed border-sim ${type} font-medium whitespace-nowrap text-sim`}>
      {label}
    </span>
  )
}
