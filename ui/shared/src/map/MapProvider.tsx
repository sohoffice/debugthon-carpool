import { APIProvider } from '@vis.gl/react-google-maps'
import type { ReactNode } from 'react'
import { MAPS_API_KEY } from './config'

/** Loads the Google Maps script once. Wrap the app root with it. */
export function MapProvider({ children }: { children: ReactNode }) {
  if (!MAPS_API_KEY) return <>{children}</>
  return (
    <APIProvider apiKey={MAPS_API_KEY} language="zh-TW" region="TW">
      {children}
    </APIProvider>
  )
}
