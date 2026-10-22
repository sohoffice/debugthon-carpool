import type { MockScenario, Place } from '../../shared/src/api/types.ts'

export const MOCK_PORT = 8081
export const SCENARIOS: MockScenario[] = ['normal', 'reassign', 'no_cars']

/** Car speed in town at rush hour (~13 km/h), used for movement and ETAs. */
export const SPEED_MPS = 3.5
/** A trip ends when the car is this close to its destination (UD-16). */
export const ARRIVAL_RADIUS_M = 50
/** A car departing from the driver UI starts this far (in time) before its pickup point. */
export const HUMAN_START_ETA_S = 240
/** Starting ETAs of the seeded simulated trips, so the timeline is spread out (7.2). */
export const SIMULATED_START_ETA_S: Record<string, number> = { driver1: 180, driver2: 360, driver3: 510 }
/** Driver confirm timeout in the reassign scenario, so a timeout happens within a demo. */
export const REASSIGN_TIMEOUT_S = 15

export const WALK_SPEED_MPS = 1.25

/** Demo passengers' habitual data (seed note in DEV.md): passenger1 skips destination setup (UD-18). */
export const PASSENGER_PROFILES: Record<string, { arrival: string; destination: Place; acceptedStopIds: number[] }> = {
  passenger1: {
    arrival: '08:15',
    destination: { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 },
    // Open-data stop ids: 瑞光港墘路口, 港墘路.
    acceptedStopIds: [1013, 1106],
  },
}

/**
 * driver4 departed yesterday, so its departure screen is prefilled (REQ-016); driver5 never did.
 * Like seed_demo_habitual_data(), the trip has no 只載 filter: its 不抽菸 suggestion went with DD-42.
 */
export const PREVIOUS_TRIPS: Record<string, { pickup: string; destination: Place; capacity: number; autoAccept: boolean }> = {
  driver4: {
    pickup: '松山車站',
    destination: { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 },
    capacity: 3,
    autoAccept: false,
  },
}
