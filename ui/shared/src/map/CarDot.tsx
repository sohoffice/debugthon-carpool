import { AdvancedMarker } from '@vis.gl/react-google-maps'
import type { LatLng } from './config'

/** A small route-colour dot with a white ring: a car on a trip, with no name or plate (REQ-081, UD-26). */
export function CarDot({ position }: { position: LatLng }) {
  return (
    <AdvancedMarker position={position} zIndex={3} anchorLeft="-50%" anchorTop="-50%">
      <span className="block size-3.5 rounded-full border-2 border-white bg-brand shadow-sm shadow-ink/40" />
    </AdvancedMarker>
  )
}
