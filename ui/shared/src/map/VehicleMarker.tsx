import { AdvancedMarker } from '@vis.gl/react-google-maps'
import type { VehiclePosition } from '../api/types'
import { useSmoothVehicle } from './useSmoothVehicle'

interface VehicleMarkerProps {
  position: VehiclePosition | null
  /** The poll interval, so the car glides from one report to the next (UD-15). */
  pollIntervalMs: number
  title?: string
}

/** Top-down car in the route colour, nose up = north, turned to its heading. The map never rotates. */
export function VehicleMarker({ position, pollIntervalMs, title }: VehicleMarkerProps) {
  const shown = useSmoothVehicle(position, pollIntervalMs)
  if (!shown) return null
  return (
    <AdvancedMarker position={shown.position} title={title} zIndex={3} anchorLeft="-50%" anchorTop="-50%">
      <svg
        width="26"
        height="44"
        viewBox="0 0 26 44"
        className="drop-shadow-md transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{ transform: `rotate(${shown.rotation}deg)` }}
      >
        <rect x="2" y="2" width="22" height="40" rx="8" className="fill-brand stroke-white" strokeWidth="3" />
        <rect x="6" y="10" width="14" height="8" rx="2" className="fill-white/85" />
        <rect x="6" y="29" width="14" height="6" rx="2" className="fill-white/60" />
      </svg>
    </AdvancedMarker>
  )
}
