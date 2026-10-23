import { pathAlongBearing, pathAround, type CityGateway, type CityTrafficSlot, type LatLng } from '@carpool/shared'
import { congestionLevel, LEVEL_NAMES, vsUsualLevel, type CongestionLevel, type VsUsualLevel } from './congestion'
import type { CellKind } from './gatewayRows'
import { monthDay, slotLabel, weekdayOf } from './format'

/** 路況 colours by speed ÷ reference; 比平常 by speed against the other days at the same time (DD-44). */
export type TrafficMode = 'level' | 'vs-usual'

export interface CellReading {
  /** congestion-n in 路況, vs-usual-n in 比平常; null is no data. */
  level: CongestionLevel | VsUsualLevel | null
  widthPx: number
  /** No data: a dashed line and a hatched cell, so it does not rely on colour (UD-28). */
  dashed: boolean
}

// Line widths per level, thicker when slower (SC-C1): 路況 4, 5, 7, 9; 比平常 4, 4, 7, 9; no data 3.
const LEVEL_WIDTH = [4, 5, 7, 9]
const VS_USUAL_WIDTH = [4, 4, 7, 9]
const NO_DATA: CellReading = { level: null, widthPx: 3, dashed: true }

/**
 * A gateway in a slot as drawn on the line and the cell. A slot of today not over yet draws the
 * usual speed in 路況 and always 差不多 in 比平常 (SC-C1).
 */
export function readCell(g: CityGateway, kind: CellKind, mode: TrafficMode): CellReading {
  if (kind === 'not-yet') {
    if (mode === 'vs-usual') return { level: 2, widthPx: VS_USUAL_WIDTH[1], dashed: false }
    if (g.past_avg_speed_kmh === null) return NO_DATA
    const level = congestionLevel(g.past_avg_speed_kmh / g.reference_speed_kmh)
    return { level, widthPx: LEVEL_WIDTH[level - 1], dashed: false }
  }
  if (g.avg_speed_kmh === null) return NO_DATA
  if (mode === 'vs-usual') {
    if (g.past_avg_speed_kmh === null) return NO_DATA
    const level = vsUsualLevel(g.avg_speed_kmh, g.past_avg_speed_kmh)
    return { level, widthPx: VS_USUAL_WIDTH[level - 1], dashed: false }
  }
  const level = congestionLevel(g.avg_speed_kmh / g.reference_speed_kmh)
  return { level, widthPx: LEVEL_WIDTH[level - 1], dashed: false }
}

// UD-28: a shape is cut to about 320 m either side of the detector; without one, 520 m along the bearing.
const SHAPE_HALF_M = 320
const BEARING_LENGTH_M = 520
const BEARINGS: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 }

/** The gateway's line on the map, in the direction of travel (UD-28). */
export function gatewayPath(g: CityGateway): LatLng[] {
  const along = g.shape ? pathAround(g, g.shape, SHAPE_HALF_M) : null
  return along ?? pathAlongBearing(g, BEARINGS[g.bearing] ?? 0, BEARING_LENGTH_M)
}

const ratio = (g: CityGateway) => (g.avg_speed_kmh === null ? Infinity : g.avg_speed_kmh / g.reference_speed_kmh)

/** The slot's slowest gateways by speed ÷ reference, lowest first; gateways without data left out (SC-C1). */
export function slowestThree(slot: CityTrafficSlot): CityGateway[] {
  return slot.detectors
    .filter((g) => g.avg_speed_kmh !== null)
    .sort((a, b) => ratio(a) - ratio(b))
    .slice(0, 3)
}

/** The gateway selected on opening: the lowest speed ratio in the slot, else the first (SC-C1). */
export function defaultGateway(slot: CityTrafficSlot): string | undefined {
  return slowestThree(slot)[0]?.vd_id ?? slot.detectors[0]?.vd_id
}

/** Where a slot's traffic comes from (UD-28): only a slot with data is TDX 實測 or 模擬. */
export function sourceOf(slot: CityTrafficSlot, notYet: boolean): 'TDX 實測' | '模擬' | '還沒到' | '沒有資料' {
  if (notYet) return '還沒到'
  if (!slot.detectors.some((g) => g.avg_speed_kmh !== null)) return '沒有資料'
  return slot.simulated ? '模擬' : 'TDX 實測'
}

/** The name on screen with the proxy mark (DD-36, UD-28). */
export const gatewayName = (g: CityGateway) => `${g.sort_order}. ${g.gateway}${g.proxy ? ' *' : ''}`

/** The proxy note for the tooltip and the right column; null for a gateway on its own detector. */
export const proxyLine = (g: CityGateway) => (g.proxy && g.proxy_note ? `代理值：偵測器在${g.proxy_note}` : null)

/** The tooltip of a line or a cell (SC-C1), one entry per line. */
export function tooltipLines(g: CityGateway, kind: CellKind, date: string, time: string, source: string): string[] {
  const head = [gatewayName(g), `${monthDay(date)} 週${weekdayOf(date)} ${slotLabel(time)} · ${source}`]
  const proxy = proxyLine(g)
  const tail = proxy ? [proxy] : []
  if (kind === 'not-yet') {
    if (g.past_avg_speed_kmh === null) return [...head, '這個時段還沒到', ...tail]
    const level = congestionLevel(g.past_avg_speed_kmh / g.reference_speed_kmh)
    return [...head, `平常這時候 ${Math.round(g.past_avg_speed_kmh)} km/h · ${LEVEL_NAMES[level]}`, ...tail]
  }
  if (g.avg_speed_kmh === null) return [...head, '這個時段沒有資料', ...tail]
  const r = g.avg_speed_kmh / g.reference_speed_kmh
  const lines = [...head, `${LEVEL_NAMES[congestionLevel(r)]} · ${Math.round(g.avg_speed_kmh)} km/h（參考速度 ${g.reference_speed_kmh} 的 ${Math.round(r * 100)}%）`]
  if (g.past_avg_speed_kmh !== null) {
    const diff = Math.round((g.avg_speed_kmh / g.past_avg_speed_kmh - 1) * 100)
    lines.push(`其他天同時段平均 ${Math.round(g.past_avg_speed_kmh)} km/h，${diff >= 0 ? '快' : '慢'} ${Math.abs(diff)}%`)
  }
  lines.push(`佔有率 ${g.occupancy_pct === null ? '—' : `${Math.round(g.occupancy_pct)}%`} · 車流 ${g.volume ?? '—'} 輛／15 分`)
  if (g.coverage_pct !== null && g.coverage_pct < 100) lines.push(`這格只收到 ${Math.round(g.coverage_pct)}% 的資料，車流量按比例補足`)
  return [...lines, ...tail]
}
