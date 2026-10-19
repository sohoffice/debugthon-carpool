import { useCallback, useEffect, useState } from 'react'
import type { LatLng, PickupPoint } from '@carpool/shared'
import { account } from './config'

/** Where the debug mode can put the passenger (DD-26): next to a pickup point, or too far away (REQ-034). */
export interface PositionPreset {
  id: string
  label: string
  pickupName: string
  /** Metres north of the pickup point. */
  offsetM: number
}

export const POSITION_PRESETS: PositionPreset[] = [
  { id: 'songshan', label: '松山車站旁', pickupName: '松山車站', offsetM: 25 },
  { id: 'wtc', label: '台北世貿中心旁', pickupName: '台北世貿中心', offsetM: 25 },
  { id: 'dome', label: '台北大巨蛋旁', pickupName: '台北大巨蛋', offsetM: 25 },
  { id: 'songshan-far', label: '離松山車站 420 公尺', pickupName: '松山車站', offsetM: 420 },
]

const DEFAULT_PRESET = POSITION_PRESETS[0].id
const METRES_PER_DEGREE_LAT = 111195
const storageKey = `carpool.position.${account}`

export function presetPosition(presetId: string, pickupPoints: PickupPoint[]): LatLng | null {
  const preset = POSITION_PRESETS.find((p) => p.id === presetId) ?? POSITION_PRESETS[0]
  const pickup = pickupPoints.find((p) => p.name === preset.pickupName)
  return pickup ? { lat: pickup.lat + preset.offsetM / METRES_PER_DEGREE_LAT, lng: pickup.lng } : null
}

function readPreset(): string {
  try {
    return localStorage.getItem(storageKey) ?? DEFAULT_PRESET
  } catch {
    return DEFAULT_PRESET
  }
}

/**
 * The passenger's single "current position" source (DD-26). The PoC takes it from the debug mode;
 * a real phone would use its location instead. Remembered per account, and shared live with other
 * tabs of the same account, so a debug tab can move the passenger shown on the showcase page.
 */
export function useCurrentPosition(pickupPoints: PickupPoint[]) {
  const [presetId, setPresetIdState] = useState(readPreset)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === storageKey && setPresetIdState(e.newValue ?? DEFAULT_PRESET)
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setPresetId = useCallback((id: string) => {
    setPresetIdState(id)
    try {
      localStorage.setItem(storageKey, id)
    } catch {
      // Private mode: the position just is not remembered.
    }
  }, [])

  return { presetId, setPresetId, position: presetPosition(presetId, pickupPoints) }
}
