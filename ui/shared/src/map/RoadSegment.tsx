import { AdvancedMarker, Polyline } from '@vis.gl/react-google-maps'
import { MAP_COLORS, type LatLng } from './config'

interface RoadSegmentProps {
  /** Points in the direction of travel. */
  path: LatLng[]
  /** A literal colour: the Maps API cannot read theme tokens. */
  color: string
  widthPx: number
  /** No data: a thin dashed line, so it does not rely on colour (UD-28). */
  dashed?: boolean
  /** The detector: a white circle with this number; none when absent. */
  badge?: { position: LatLng; label: string; selected?: boolean }
  opacity?: number
  /** Drawn below everything else, e.g. under the cars. */
  zIndex?: number
  title?: string
  onHover?: (over: boolean, at?: { x: number; y: number }) => void
  onClick?: () => void
}

const DASH_PX = 4
// Two white chevrons along the line show the direction of travel (UD-28).
const ARROW_OFFSETS = ['22%', '78%']

/**
 * A short stretch of road coloured by its traffic, on a white casing (UD-28): a city war room
 * gateway's line, with its detector's number in a circle.
 */
export function RoadSegment({ path, color, widthPx, dashed = false, badge, opacity = 1, zIndex = 1, title, onHover, onClick }: RoadSegmentProps) {
  const arrow: google.maps.Symbol = {
    path: 'M -1.6 1.4 L 0 -0.4 L 1.6 1.4',
    strokeColor: MAP_COLORS.white,
    strokeOpacity: opacity,
    strokeWeight: 1.8,
    scale: Math.max(3, widthPx * 0.55),
  }
  const dash: google.maps.Symbol = { path: 'M 0 -1 L 0 1', strokeColor: color, strokeOpacity: opacity, strokeWeight: widthPx, scale: DASH_PX / 2 }
  const hover = (over: boolean) => (e: google.maps.MapMouseEvent) => {
    const dom = e.domEvent as MouseEvent | undefined
    onHover?.(over, dom ? { x: dom.clientX, y: dom.clientY } : undefined)
  }
  return (
    <>
      <Polyline path={path} strokeColor={MAP_COLORS.white} strokeOpacity={opacity} strokeWeight={widthPx + 3} zIndex={zIndex} clickable={false} />
      <Polyline
        path={path}
        strokeColor={color}
        strokeOpacity={dashed ? 0 : opacity}
        strokeWeight={widthPx}
        zIndex={zIndex + 1}
        icons={dashed ? [{ icon: dash, offset: '0', repeat: `${DASH_PX * 2}px` }] : ARROW_OFFSETS.map((offset) => ({ icon: arrow, offset }))}
        clickable={false}
      />
      {(onHover || onClick) && (
        // A wide transparent line so the segment is easy to point at.
        <Polyline
          path={path}
          strokeOpacity={0}
          strokeWeight={22}
          zIndex={zIndex + 2}
          onMouseOver={hover(true)}
          onMouseOut={hover(false)}
          onClick={onClick}
        />
      )}
      {badge && (
        <AdvancedMarker position={badge.position} title={title} zIndex={zIndex + 3} anchorLeft="-50%" anchorTop="-50%" onClick={onClick}>
          <span
            className={`flex size-4 items-center justify-center rounded-full border-[1.4px] border-ink bg-white text-[9.5px] font-extrabold text-ink ${badge.selected ? 'outline-2 outline-offset-[3px] outline-ink outline-dashed' : ''}`}
          >
            {badge.label}
          </span>
        </AdvancedMarker>
      )}
    </>
  )
}
