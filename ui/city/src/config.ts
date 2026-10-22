import { createApiClient, getAccountFromUrl } from '@carpool/shared'

// The dashboard account seeded by the city admin migration (DD-39); switch with ?account=<name>.
const DEFAULT_ACCOUNT = 'city1'

// Each area polls on its own (DD-03). Only the cars on the map move, so live is the fastest.
export const LIVE_POLL_MS = 3000
export const TODAY_POLL_MS = 5000
export const TRAFFIC_POLL_MS = 15000
export const HISTORY_POLL_MS = 60000

export const account = getAccountFromUrl(DEFAULT_ACCOUNT)
export const api = createApiClient('city', account)
