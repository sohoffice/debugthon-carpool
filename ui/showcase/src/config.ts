// The apps run on their own dev servers (ui/CLAUDE.md); the showcase embeds them (UD-18, UD-30).
const DRIVER_PORT = 5173
const PASSENGER_PORT = 5174
const CITY_PORT = 5175

const params = new URLSearchParams(window.location.search)
// Demo accounts: driver4 departs on stage (UD-14); switch with ?driver=…&passenger=….
const driver = params.get('driver') ?? 'driver4'
const passenger = params.get('passenger') ?? 'passenger1'

const appUrl = (port: number, query: string) => `${window.location.protocol}//${window.location.hostname}:${port}/?${query}`

export const DRIVER_URL = appUrl(DRIVER_PORT, `embed=1&account=${encodeURIComponent(driver)}`)
export const PASSENGER_URL = appUrl(PASSENGER_PORT, `embed=1&account=${encodeURIComponent(passenger)}`)
// The city war room, a desktop page: no phone frame, so no embed (UD-30 part 3).
export const CITY_URL = appUrl(CITY_PORT, 'account=city1')

/** The simulator confirms the seeded trips' requests this often, like the driver UI's polling (DD-33). */
export const POLL_INTERVAL_MS = 1000
/** The off-stage round: driver5 follows driver4 and declines; retried this often while the backend is down (DD-45). */
export const OFFSTAGE_POLL_MS = 1000
