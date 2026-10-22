import {
  ApiError,
  CommuteInfo,
  PhoneShell,
  useMyTags,
  type BusStop,
  type CurrentRequest,
  type PassengerProfile,
  type PassengerSearch,
  type PickupPoint,
  type RequestStatusView,
  type RequestView,
  type Tag,
  type TagFilter,
} from '@carpool/shared'
import { useCallback, useEffect, useState } from 'react'
import { api, DEBUG } from './config'
import { DestinationScreen } from './DestinationScreen'
import { LoadingScreen } from './LoadingScreen'
import { PassengerDebugMode } from './PassengerDebugMode'
import { useCurrentPosition } from './position'
import { RequestFlow } from './RequestFlow'
import { dropUnusableFilters, loadFilters, saveFilters } from './savedFilters'
import { isComplete, nearestPickup, searchFromProfile } from './search'
import { SubmitSheet } from './SubmitSheet'
import { SupplyScreen } from './SupplyScreen'

type View =
  /** `missing`: the backend answered 404, so it does not have this API yet (not a connection problem). */
  | { kind: 'loading'; failed: boolean; missing?: string }
  | { kind: 'setup' }
  | { kind: 'supply'; notice: string | null }
  | { kind: 'request'; request: RequestStatusView; fresh: boolean }

const fetchCurrent = () => api.get<CurrentRequest>('/passenger/requests/current')

/** The habitual search with the filters this browser last used (REQ-025, 7.1). */
function habitualSearch(profile: PassengerProfile): PassengerSearch | null {
  const fromProfile = searchFromProfile(profile)
  return fromProfile && { ...fromProfile, tag_filters: loadFilters() }
}

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading', failed: false })
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([])
  const [busStops, setBusStops] = useState<BusStop[]>([])
  const [search, setSearch] = useState<PassengerSearch | null>(null)
  const [chosenPickupId, setChosenPickupId] = useState<number | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  const [commuteOpen, setCommuteOpen] = useState(false)
  const myTags = useMyTags(api)
  const { presetId, setPresetId, position } = useCurrentPosition(pickupPoints)

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const [points, stops, profile, current, tags] = await Promise.all([
          api.get<PickupPoint[]>('/pickup-points'),
          api.get<BusStop[]>('/bus-stops'),
          api.get<PassengerProfile>('/passenger/profile'),
          fetchCurrent(),
          api.get<Tag[]>('/tags'),
        ])
        if (cancelled) return
        // Before the first supply query: an old filter the backend refuses would fail it (REQ-085).
        dropUnusableFilters(tags)
        const habitual = habitualSearch(profile)
        setPickupPoints(points)
        setBusStops(stops)
        setSearch(habitual)
        // An open request comes back after a reload, with no way to send another (REQ-069); habitual data skips the setup (5, REQ-025).
        if (current.request) setView({ kind: 'request', request: current.request, fresh: false })
        else setView(isComplete(habitual) ? { kind: 'supply', notice: null } : { kind: 'setup' })
      } catch (err) {
        const missing = err instanceof ApiError && err.status === 404 ? err.message : undefined
        if (!cancelled) setView({ kind: 'loading', failed: true, missing })
        setTimeout(() => !cancelled && boot(), 3000)
      }
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [])

  // Whatever filters the passenger last used come back next time (7.1).
  const filters = search?.tag_filters
  useEffect(() => {
    if (filters) saveFilters(filters)
  }, [filters])

  // Moving the passenger (debug mode) picks the nearest pickup point again.
  useEffect(() => setChosenPickupId(null), [presetId])
  const pickup = pickupPoints.find((p) => p.id === chosenPickupId) ?? nearestPickup(pickupPoints, position)

  /** "送出請求": take part first and wait, then send with the position and report it too (DD-25). */
  async function submit(filters: TagFilter[]) {
    if (!search || !pickup || !position) return
    const next = { ...search, tag_filters: filters }
    setSearch(next)
    setSubmitting(true)
    setSubmitError(null)
    try {
      // The backend takes a second request; the UI does not send one while another is open (REQ-069).
      const { request: open } = await fetchCurrent()
      if (open) {
        setSheetOpen(false)
        setView({ kind: 'request', request: open, fresh: false })
        return
      }
      await api.post('/activities')
      api.post('/location', position).catch(() => undefined)
      const sent = await api.post<RequestView>('/passenger/requests', {
        pickup_point_id: pickup.id,
        location: position,
        destination: next.destination,
        stop_ids: next.accepted_stop_ids,
        tag_filters: next.tag_filters,
      })
      // The answer is already decided (REQ-036); the status view adds the car and trip.
      const request = await api.get<RequestStatusView>(`/passenger/requests/${sent.id}`)
      setSheetOpen(false)
      setView({ kind: 'request', request, fresh: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'destination_outside_park') setSubmitError('目的地不在內湖科學園區內，請先修改目的地。')
      else setSubmitError(err instanceof ApiError && err.status < 500 ? err.message : '沒有送出成功，請再按一次。')
    } finally {
      setSubmitting(false)
    }
  }

  const backToSupply = useCallback((notice: string | null) => {
    setReporting(false)
    // Opened on a request without a search (reloaded mid-ride): the finished ride has just updated the habitual data (DD-19).
    api
      .get<PassengerProfile>('/passenger/profile')
      .then((profile) => setSearch((s) => s ?? habitualSearch(profile)), () => undefined)
      .finally(() => setView({ kind: 'supply', notice }))
  }, [])

  let screen
  if (view.kind === 'loading') {
    screen = <LoadingScreen failed={view.failed} missing={view.missing} />
  } else if (view.kind === 'request') {
    // Before the search checks: an open request comes back even without habitual data.
    screen = (
      <RequestFlow
        key={view.request.id}
        initial={view.request}
        fresh={view.fresh}
        position={position}
        pickupPoints={pickupPoints}
        busStops={busStops}
        onBack={backToSupply}
        onOpenChange={setReporting}
      />
    )
  } else if (view.kind === 'setup' || !isComplete(search) || pickup === null) {
    screen = (
      <DestinationScreen
        initial={search}
        busStops={busStops}
        myTags={myTags}
        onDone={(s) => (setSearch(s), setView({ kind: 'supply', notice: null }))}
        onOpenCommute={() => setCommuteOpen(true)}
      />
    )
  } else {
    screen = (
      <>
        <SupplyScreen
          search={search}
          pickupPoints={pickupPoints}
          pickup={pickup}
          position={position}
          busStops={busStops}
          notice={view.notice}
          onPickPickup={setChosenPickupId}
          onEdit={() => setView({ kind: 'setup' })}
          onRide={() => (setSubmitError(null), setSheetOpen(true))}
        />
        {sheetOpen && (
          <SubmitSheet
            myTags={myTags}
            filters={search.tag_filters}
            submitting={submitting}
            error={submitError}
            onSubmit={submit}
            onClose={() => setSheetOpen(false)}
          />
        )}
      </>
    )
  }

  return (
    <PhoneShell roleLabel="乘客" tone="dark">
      {screen}
      {/* Over the destination screen, which keeps what was typed for the back button (SC-X4). */}
      {commuteOpen && <CommuteInfo api={api} ground="light" defaultPickupId={pickup?.id ?? null} onBack={() => setCommuteOpen(false)} />}
      {DEBUG && <PassengerDebugMode presetId={presetId} position={position} reporting={reporting} onPreset={setPresetId} />}
    </PhoneShell>
  )
}
