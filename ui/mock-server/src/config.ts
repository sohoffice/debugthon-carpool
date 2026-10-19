import type { MockScenario, Place, Vehicle } from '../../shared/src/api/types.ts'

export const MOCK_PORT = 8081
export const SCENARIOS: MockScenario[] = ['normal', 'reassign', 'no_cars', 'too_far']

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
export const BUS_SPEED_MPS = 5
export const BUS_WAIT_S = 300

/** Fake vehicles; the schema has no vehicle data yet (backend to add). */
export const VEHICLES: Record<string, Vehicle> = {
  driver1: { plate: 'BKR-5821', color: '白色', model: 'Toyota Corolla Altis' },
  driver2: { plate: 'RDA-3307', color: '銀色', model: 'Honda CR-V' },
  driver3: { plate: 'AJX-1962', color: '黑色', model: 'Mazda 3' },
  driver4: { plate: 'BEN-0824', color: '白色', model: 'Toyota RAV4' },
  driver5: { plate: 'RCF-7713', color: '灰色', model: 'Nissan Kicks' },
}

/** Demo passengers' habitual data (seed note in DEV.md): passenger1 skips destination setup (UD-18). */
export const PASSENGER_PROFILES: Record<string, { arrival: string; destination: Place; acceptedStopIds: number[] }> = {
  passenger1: {
    arrival: '08:15',
    destination: { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 },
    // Open-data stop ids: 瑞光港墘路口, 港墘路.
    acceptedStopIds: [1013, 1106],
  },
}

/** driver4 departed yesterday, so its departure screen is prefilled (REQ-016); driver5 never did. */
export const PREVIOUS_TRIPS: Record<string, { pickup: string; destination: Place; capacity: number; autoAccept: boolean; preferredTags: string[] }> = {
  driver4: {
    pickup: '松山車站',
    destination: { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 },
    capacity: 3,
    autoAccept: false,
    preferredTags: ['不抽菸'],
  },
}

/** Where the passengers stand: at the pickup point, or 420 m away in the too_far scenario. */
export const PASSENGER_OFFSET_M = { near: 25, far: 420 }

/** Walking alternative description per pickup point (REQ-051). */
export const WALK_VIA: Record<string, string> = { 松山車站: '塔悠路、堤頂大道' }
