// The two apps run on their own dev servers (ui/CLAUDE.md); the showcase embeds them (UD-18).
const DRIVER_PORT = 5173
const PASSENGER_PORT = 5174

const params = new URLSearchParams(window.location.search)
// Demo accounts: driver4 departs on stage (UD-14); switch with ?driver=…&passenger=….
const driver = params.get('driver') ?? 'driver4'
const passenger = params.get('passenger') ?? 'passenger1'

const appUrl = (port: number, account: string) =>
  `${window.location.protocol}//${window.location.hostname}:${port}/?embed=1&account=${encodeURIComponent(account)}`

export const DRIVER_URL = appUrl(DRIVER_PORT, driver)
export const PASSENGER_URL = appUrl(PASSENGER_PORT, passenger)
