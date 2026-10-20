import { useEffect, useRef, useState } from 'react'
import type { VehiclePosition } from '../api/types'
import { useReducedMotion } from '../hooks/useReducedMotion'
import type { LatLng } from './config'
import { lerp, nextHeading, shortestTurn, shouldJump } from './vehicleMotion'

export interface SmoothVehicle {
  position: LatLng
  /** Degrees, unbounded: always changed by the shortest turn so a CSS transition never spins (UD-15). */
  rotation: number
}

/**
 * Where to draw the car: from where it is on screen to each new report, at constant speed over
 * one poll interval, so it trails reality by about one poll but never jumps back (UD-15).
 */
export function useSmoothVehicle(target: VehiclePosition | null, pollIntervalMs: number): SmoothVehicle | null {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState<SmoothVehicle | null>(null)
  const shownRef = useRef<SmoothVehicle | null>(null)
  const last = useRef<{ position: LatLng; at: number } | null>(null)
  shownRef.current = shown

  const key = target ? `${target.lat},${target.lng},${target.heading_deg},${target.reported_at}` : ''
  useEffect(() => {
    if (!target) {
      setShown(null)
      last.current = null
      return
    }
    const to = { lat: target.lat, lng: target.lng }
    const now = Date.now()
    const previous = last.current
    const from = shownRef.current
    last.current = { position: to, at: now }

    const rotationNow = from?.rotation ?? target.heading_deg ?? 0
    const heading = nextHeading(target.heading_deg, ((rotationNow % 360) + 360) % 360)
    const rotation = rotationNow + shortestTurn(rotationNow, heading)

    const missedPolls = previous ? Math.floor((now - previous.at) / pollIntervalMs) - 1 : 0
    if (!from || reduced || shouldJump(from.position, to, missedPolls)) {
      setShown({ position: to, rotation })
      return
    }

    let frame = 0
    const start = performance.now()
    const step = (t: number) => {
      const progress = Math.min((t - start) / pollIntervalMs, 1)
      setShown({ position: lerp(from.position, to, progress), rotation })
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // `key` stands for the target's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced, pollIntervalMs])

  return shown
}
