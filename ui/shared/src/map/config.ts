export interface LatLng {
  lat: number
  lng: number
}

export const MAPS_API_KEY: string = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
// AdvancedMarker needs a Map ID; DEMO_MAP_ID is Google's free test ID.
export const MAPS_MAP_ID: string = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID'

/** Fits the three pickup points (Songshan, World Trade Center, Taipei Dome) and Neihu Science Park. */
export const DEFAULT_CENTER: LatLng = { lat: 25.0615, lng: 121.5705 }
export const DEFAULT_ZOOM = 13

/** Map drawing colours, the same as the brand tokens in theme.css (8.1); the Maps API needs literal values. */
export const MAP_COLORS = { brand: '#0a7a68', white: '#ffffff', ink: '#1a242c' }
