import { ROAD_COLORS, RoadSegment } from '@carpool/shared'
import type { GridCell } from './gatewayRows'
import { gatewayPath, readCell, type TrafficMode } from './trafficView'

interface GatewayLinesProps {
  /** One cell per gateway, all in the same slot. */
  cells: GridCell[]
  mode: TrafficMode
  selected?: string
  /** The live map's overlay: 80% opaque, no numbers, under the cars (SC-C1). */
  overlay?: boolean
  onSelect?: (vdId: string) => void
  onHover?: (cell: GridCell | null, at?: { x: number; y: number }) => void
}

/** The 16 gateways' lines on the map, coloured and sized by the mode (UD-28, DD-44). */
export function GatewayLines({ cells, mode, selected, overlay = false, onSelect, onHover }: GatewayLinesProps) {
  return (
    <>
      {cells.map((c) => {
        const r = readCell(c.at, c.kind, mode)
        const palette = mode === 'vs-usual' ? ROAD_COLORS.vsUsual : ROAD_COLORS.congestion
        const color = r.level === null ? ROAD_COLORS.noData : palette[r.level - 1]
        const g = c.at
        return (
          <RoadSegment
            key={g.vd_id}
            path={gatewayPath(g)}
            color={color}
            widthPx={r.widthPx}
            dashed={r.dashed}
            opacity={overlay ? 0.8 : 1}
            zIndex={overlay ? 0 : 1}
            title={c.label}
            badge={overlay ? undefined : { position: g, label: String(g.sort_order), selected: g.vd_id === selected }}
            onClick={onSelect && (() => onSelect(g.vd_id))}
            onHover={onHover && ((over, at) => onHover(over ? c : null, at))}
          />
        )
      })}
    </>
  )
}
