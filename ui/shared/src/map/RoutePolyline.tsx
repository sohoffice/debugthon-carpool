import { Polyline } from '@vis.gl/react-google-maps'
import type { LatLng } from './config'

type RoutePolylineProps =
  | { path: LatLng[]; encodedPath?: never; color?: string }
  /** Google encoded polyline, e.g. straight from the Routes API response. */
  | { encodedPath: string; path?: never; color?: string }

export function RoutePolyline({ path, encodedPath, color = '#0f766e' }: RoutePolylineProps) {
  return <Polyline path={path} encodedPath={encodedPath} strokeColor={color} strokeOpacity={0.85} strokeWeight={5} />
}
