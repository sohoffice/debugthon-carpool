import { useMap } from '@vis.gl/react-google-maps'
import { useEffect } from 'react'
import type { LatLng } from './config'

export interface MapPadding {
  top: number
  right: number
  bottom: number
  left: number
}

const DEFAULT_PADDING: MapPadding = { top: 56, right: 32, bottom: 32, left: 32 }

/**
 * Frames the map to fit `points`, keeping `padding` free, e.g. under a legend or a sheet. Inside a
 * MapView; refits only when the points change, so the viewer can pan and zoom in between.
 */
export function FitBounds({ points, padding = DEFAULT_PADDING }: { points: LatLng[]; padding?: MapPadding }) {
  const map = useMap()
  const key = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';')
  useEffect(() => {
    if (!map || points.length === 0) return
    const bounds = new google.maps.LatLngBounds()
    points.forEach((p) => bounds.extend(p))
    map.fitBounds(bounds, padding)
    // `key` stands for the points; padding is fixed per screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}
