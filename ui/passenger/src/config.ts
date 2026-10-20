import { createApiClient, getAccountFromUrl, isDebugMode } from '@carpool/shared'

// Default demo account; switch with ?account=<name>. Must match the seed SQL.
// passenger1 has habitual data and opens on the supply board; passenger2 starts at the destination setup.
const DEFAULT_ACCOUNT = 'passenger1'

// Polls supply and request status (DD-03).
export const POLL_INTERVAL_MS = 3000

/** How often the current position is reported once taking part (DD-26). */
export const LOCATION_REPORT_MS = 10000

export const account = getAccountFromUrl(DEFAULT_ACCOUNT)
export const api = createApiClient('passenger', account)

/** `?debug=1`: set the passenger's current position (DD-26). */
export const DEBUG = isDebugMode()
