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
export const MAP_COLORS = { brand: '#00707c', white: '#ffffff', ink: '#132126' }

/** The city war room's road lines (8.1, UD-28): congestion-1..4, vs-usual-1..4 and no-data, as literal values. */
export const ROAD_COLORS = {
  congestion: ['#3b82c4', '#e3a51c', '#e2632c', '#b42232'],
  vsUsual: ['#3b82c4', '#a3adb1', '#e2632c', '#b42232'],
  noData: '#a9b7ba',
} as const
