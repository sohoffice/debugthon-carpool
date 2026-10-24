// Static site only: the driver tour (T69, DD-46). The visitor drives driver4; a simulated passenger
// asks for a ride through the public API, the simulator moves the car (DD-14), and the coach bar
// says what to press. Injected by build.ts into the static driver page only.
import { createApiClient, type ApiClient, type DriverRequests, type PassengerProfile, type RequestView, type Tag, type TripView } from '@carpool/shared'
import { createSimulator } from '../showcase/src/simulator.ts'
import { clearStageTagsFromSeeded, SEEDED_WITH_STAGE_TAGS, selectStageTags, STAGE_TAGS } from '../showcase/src/stageTag.ts'
import { DRIVER_STEPS, driverStep, INITIAL_SENDER, nextSender, type DriverTourState, type SenderState } from './driverSteps.ts'
import { isEmbedded, runTour } from './tour.ts'

/** The driver app's default account: the stage car, prefilled from its seeded trip (REQ-016). */
const DRIVER = 'driver4'
/**
 * The simulated passengers, one per request: a declined one is reassigned to a seeded car and stays
 * open, and a passenger has one open request at a time (REQ-069). passenger2 has no habitual data
 * (DD-19), so the tour sends the destination and stops itself and depends on no seed.
 */
const PASSENGERS = ['passenger2', 'passenger1']
/** 25 m north of 松山車站, like the passenger debug mode's preset (DD-26), inside the submit distance. */
const PICKUP_NAME = '松山車站'
const METRES_PER_DEGREE_LAT = 111195
const NEAR_PICKUP_M = 25
/** driver4's destination, so the drop-off is the driver's own (DD-19 seed). */
const DESTINATION = { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }
/** The passenger whose seeded stops (瑞光港墘路口, 港墘路) every simulated request takes, for the same destination. */
const STOPS_FROM = 'passenger1'

/** Twice the app's polling, so the bar changes with the screen, not a second after it. */
const TOUR_POLL_MS = 500

const driverApi = createApiClient('driver', DRIVER)

/** As 開始 Demo does (DD-45 step 1): only driver4 carries both stage tags, so the request is driver4's. */
async function prepare() {
  await selectStageTags(driverApi, DRIVER)
  await clearStageTagsFromSeeded(createApiClient('driver', SEEDED_WITH_STAGE_TAGS.account), SEEDED_WITH_STAGE_TAGS.account)
}

async function stageTagFilters(api: ApiClient) {
  const tags = await api.get<Tag[]>('/tags')
  return tags.filter((t) => STAGE_TAGS.includes(t.name)).map((t) => ({ tag_id: t.id, intent: 'required' as const }))
}

/** The simulated passenger's request: take part, report where they stand, then ask (DD-25). */
async function sendRequest(account: string): Promise<RequestView> {
  const api = createApiClient('passenger', account)
  const pickup = (await api.get<{ id: number; name: string; lat: number; lng: number }[]>('/pickup-points')).find((p) => p.name === PICKUP_NAME)
  if (!pickup) throw new Error(`找不到上車點「${PICKUP_NAME}」`)
  const location = { lat: pickup.lat + NEAR_PICKUP_M / METRES_PER_DEGREE_LAT, lng: pickup.lng }
  await api.post('/activities')
  await api.post('/location', location)
  return api.post<RequestView>('/passenger/requests', {
    pickup_point_id: pickup.id,
    location,
    destination: DESTINATION,
    stop_ids: (await createApiClient('passenger', STOPS_FROM).get<PassengerProfile>('/passenger/profile')).accepted_stops.map((b) => b.id),
    tag_filters: await stageTagFilters(api),
  })
}

function start() {
  createSimulator({ accounts: [DRIVER], fastForward: true }).start()

  let lastTrip: number | null = null
  let ended = false
  let sender: SenderState = INITIAL_SENDER

  async function read(): Promise<DriverTourState> {
    const requests = await driverApi.get<DriverRequests>('/driver/requests')
    if (requests.trip_id !== null) {
      lastTrip = requests.trip_id
      ended = false
    } else if (lastTrip !== null && !ended) {
      // Gone: ended by itself at the destination (DD-30), like the app's own check.
      ended = (await driverApi.get<TripView>(`/trips/${lastTrip}`)).status === 'completed'
    }
    return { tripId: requests.trip_id, pending: requests.pending.length, passengers: requests.passengers, ended }
  }

  async function act(state: DriverTourState) {
    const next = nextSender(sender, state, Date.now())
    sender = next.state
    if (!next.send) return
    const account = PASSENGERS[(sender.sent - 1) % PASSENGERS.length]
    const sent = await sendRequest(account)
    // Not to driver4 (no car, or refused): count it as seen, so the next one follows the decline delay.
    if (sent.status !== 'waiting_driver') sender = { ...sender, seen: true }
  }

  runTour({ read, detect: driverStep, steps: DRIVER_STEPS, act, intervalMs: TOUR_POLL_MS })
}

if (!isEmbedded()) {
  prepare().then(start, (err) => {
    console.warn('static driver tour: setup failed', err)
    start()
  })
}
