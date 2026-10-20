import { Polyline } from '@vis.gl/react-google-maps'
import { MAP_COLORS, type LatLng } from './config'

type RoutePolylineProps =
  | { path: LatLng[]; encodedPath?: never; color?: string }
  /** Google encoded polyline, e.g. straight from the Routes API response. */
  | { encodedPath: string; path?: never; color?: string }

/**
 * The trip route in the route colour on a white casing, so it never reads as an MRT line: the base
 * map draws metro lines in their own colours, and the 松山新店線 green is close to ours (ui-oi-17).
 */
export function RoutePolyline({ path, encodedPath, color = MAP_COLORS.brand }: RoutePolylineProps) {
  return (
    <>
      <Polyline path={path} encodedPath={encodedPath} strokeColor={MAP_COLORS.white} strokeOpacity={1} strokeWeight={11} zIndex={1} />
      <Polyline path={path} encodedPath={encodedPath} strokeColor={color} strokeOpacity={1} strokeWeight={6} zIndex={2} />
    </>
  )
}
