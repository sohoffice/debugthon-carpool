import { SimulatedBadge } from '@carpool/shared'

/**
 * Where the shown traffic comes from (UD-28): TDX 實測 in a solid route-colour outline, 模擬 as the
 * simulated mark (REQ-063); nothing for a slot without data.
 */
export function SourceBadge({ source }: { source: string }) {
  if (source === '模擬') return <SimulatedBadge />
  if (source !== 'TDX 實測') return null
  return <span className="inline-flex shrink-0 items-center rounded-[4px] border border-brand px-1.5 text-sm/[1.5] font-medium whitespace-nowrap text-brand">TDX 實測</span>
}
