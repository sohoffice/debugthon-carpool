import type { CityGateway } from '@carpool/shared'

/** DD-44's four levels: 1 順暢, 2 車多, 3 壅塞, 4 嚴重. */
export type CongestionLevel = 1 | 2 | 3 | 4

export const LEVEL_NAMES: Record<CongestionLevel, string> = { 1: '順暢', 2: '車多', 3: '壅塞', 4: '嚴重' }

/** Tailwind classes from theme.css (UD-28); no-data cells add hatching so grey is not the only cue. */
export const LEVEL_BG: Record<CongestionLevel, string> = {
  1: 'bg-congestion-1',
  2: 'bg-congestion-2',
  3: 'bg-congestion-3',
  4: 'bg-congestion-4',
}

/** Speed ÷ the gateway's all-day p85: ≥ 75% 順暢, 50–75% 車多, 30–50% 壅塞, < 30% 嚴重 (DD-44). */
export function congestionLevel(ratio: number): CongestionLevel {
  if (ratio >= 0.75) return 1
  if (ratio >= 0.5) return 2
  if (ratio >= 0.3) return 3
  return 4
}

/** 比平常's four levels (DD-44): 1 快 10% 以上, 2 差不多, 3 慢 10–25%, 4 慢 25% 以上. */
export type VsUsualLevel = 1 | 2 | 3 | 4

export const VS_USUAL_NAMES: Record<VsUsualLevel, string> = { 1: '比平常快', 2: '差不多', 3: '慢 10–25%', 4: '慢 25% 以上' }

export const VS_USUAL_BG: Record<VsUsualLevel, string> = {
  1: 'bg-vs-usual-1',
  2: 'bg-vs-usual-2',
  3: 'bg-vs-usual-3',
  4: 'bg-vs-usual-4',
}

/**
 * The slot's speed against the other days' average at the same time, the slot's day left out (DD-44):
 * ≥ +10% 快, within ±10% 差不多, slower by 10–25%, slower by 25% or more. As in congestionLevel, a
 * threshold goes to the better side: exactly −10% is 差不多, exactly −25% is 慢 10–25%.
 */
export function vsUsualLevel(speed: number, usual: number): VsUsualLevel {
  const ratio = speed / usual
  if (ratio >= 1.1) return 1
  if (ratio >= 0.9) return 2
  if (ratio >= 0.75) return 3
  return 4
}

/** The gateway's level in its slot; null without a speed. */
export function gatewayLevel(g: Pick<CityGateway, 'avg_speed_kmh' | 'reference_speed_kmh'>): CongestionLevel | null {
  return g.avg_speed_kmh === null ? null : congestionLevel(g.avg_speed_kmh / g.reference_speed_kmh)
}

/** The worst level among the gateways and how many have it, for the top bar (UD-27); null when none has data. */
export function worstLevel(levels: (CongestionLevel | null)[]): { level: CongestionLevel; count: number } | null {
  const known = levels.filter((l): l is CongestionLevel => l !== null)
  if (known.length === 0) return null
  const level = Math.max(...known) as CongestionLevel
  return { level, count: known.filter((l) => l === level).length }
}
