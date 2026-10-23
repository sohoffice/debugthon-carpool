import { APILoadingStatus, useApiLoadingStatus } from '@vis.gl/react-google-maps'
import { MAPS_API_KEY } from './config'

/**
 * False with no key, or once the Maps script failed to load (offline, key refused): for a screen
 * that leaves the map out instead of showing MapView's notice.
 */
export function useMapAvailable(): boolean {
  const status = useApiLoadingStatus()
  return MAPS_API_KEY !== '' && status !== APILoadingStatus.FAILED && status !== APILoadingStatus.AUTH_FAILURE
}
