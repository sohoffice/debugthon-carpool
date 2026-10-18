import { createApiClient, getAccountFromUrl } from '@carpool/shared'

// Default demo account; switch with ?account=<name>. Must match the seed SQL.
const DEFAULT_ACCOUNT = 'passenger1'

// Polls supply and request status (DD-03).
export const POLL_INTERVAL_MS = 3000

export const account = getAccountFromUrl(DEFAULT_ACCOUNT)
export const api = createApiClient('passenger', account)
