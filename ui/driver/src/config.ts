import { createApiClient, getAccountFromUrl } from '@carpool/shared'

// Default demo account; switch with ?account=<name>. Must match the seed SQL.
const DEFAULT_ACCOUNT = 'driver1'

// Polls for pending ride requests during a trip. Must stay well below the
// driver confirm timeout (DD-03), or drivers miss requests.
export const POLL_INTERVAL_MS = 2000

export const account = getAccountFromUrl(DEFAULT_ACCOUNT)
export const api = createApiClient('driver', account)
