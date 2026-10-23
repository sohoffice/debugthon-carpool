import { createApiClient, getAccountFromUrl, isDebugMode } from '@carpool/shared'

// Default demo account; switch with ?account=<name>. driver4 and driver5 are driven from this UI;
// driver1-3 run simulated trips (docs/ui-design.md UD-14).
const DEFAULT_ACCOUNT = 'driver4'

// Polls the trip and its pending request. Must stay well below the driver confirm timeout
// (DD-03), or drivers miss requests.
export const POLL_INTERVAL_MS = 1000

/** Seats a driver can offer (可載人數). */
export const CAPACITY_RANGE = { min: 1, max: 6, fallback: 3 }

export const account = getAccountFromUrl(DEFAULT_ACCOUNT)
export const api = createApiClient('driver', account)

/** `?debug=1`: account switch and simulator (DD-14). */
export const DEBUG = isDebugMode()
