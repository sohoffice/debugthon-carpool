import type { LatLng } from '@carpool/shared'
import { useEffect, useRef } from 'react'
import { api, LOCATION_REPORT_MS } from './config'

/**
 * While taking part, keeps sending the current position through the location API (DD-26, DD-08).
 * The latest position is read at each report, so moving the passenger in the debug mode takes effect.
 */
export function useLocationReporting(position: LatLng | null, active: boolean) {
  const latest = useRef(position)
  latest.current = position
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      // A lost report is fine; the next one follows.
      if (latest.current) api.post('/location', latest.current).catch(() => undefined)
    }, LOCATION_REPORT_MS)
    return () => clearInterval(timer)
  }, [active])
}
