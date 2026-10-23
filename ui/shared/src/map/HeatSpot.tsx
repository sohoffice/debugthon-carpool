import { AdvancedMarker } from '@vis.gl/react-google-maps'
import type { LatLng } from './config'

interface HeatSpotProps {
  position: LatLng
  /** 0..1: the detector's volume over the largest one on the map. */
  weight: number
  title?: string
}

const MIN_SIZE_PX = 48
const MAX_SIZE_PX = 140

/**
 * One soft red blob per traffic detector, larger and denser with more volume (DD-39). Drawn as a
 * marker instead of Google's HeatmapLayer, which Google has deprecated.
 */
export function HeatSpot({ position, weight, title }: HeatSpotProps) {
  const w = Math.min(Math.max(weight, 0), 1)
  const size = MIN_SIZE_PX + (MAX_SIZE_PX - MIN_SIZE_PX) * w
  const core = Math.round(25 + 55 * w)
  return (
    <AdvancedMarker position={position} title={title} zIndex={0} anchorLeft="-50%" anchorTop="-50%">
      <span
        className="pointer-events-none block rounded-full"
        style={{
          width: size,
          height: size,
          background: `radial-gradient(circle, color-mix(in srgb, var(--color-danger) ${core}%, transparent) 0%, color-mix(in srgb, var(--color-danger) ${Math.round(core / 3)}%, transparent) 45%, transparent 70%)`,
        }}
      />
    </AdvancedMarker>
  )
}
