import { Map } from '@vis.gl/react-google-maps'
import type { ReactNode } from 'react'
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAPS_API_KEY, MAPS_MAP_ID, type LatLng } from './config'

interface MapViewProps {
  center?: LatLng
  zoom?: number
  className?: string
  /** Markers and polylines from this module. */
  children?: ReactNode
}

/** The only map component apps should use. Must be inside <MapProvider>. */
export function MapView({ center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM, className = 'h-full w-full', children }: MapViewProps) {
  if (!MAPS_API_KEY) {
    return (
      <div className={`${className} flex items-center justify-center bg-brand-soft p-4 text-center text-sm text-ink-soft`}>
        地圖未設定：請在專案根目錄 .env 設定 VITE_GOOGLE_MAPS_API_KEY
      </div>
    )
  }
  return (
    <div className={className}>
      <Map
        mapId={MAPS_MAP_ID}
        defaultCenter={center}
        defaultZoom={zoom}
        gestureHandling="greedy"
        disableDefaultUI
      >
        {children}
      </Map>
    </div>
  )
}
