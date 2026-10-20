import {
  ApiError,
  PhoneShell,
  useMyTags,
  type BusStop,
  type PassengerProfile,
  type PassengerRequest,
  type PassengerRequestResponse,
  type PassengerSearch,
  type PickupPoint,
  type TagFilter,
} from '@carpool/shared'
import { useCallback, useEffect, useState } from 'react'
import { api, DEBUG } from './config'
import { DestinationScreen } from './DestinationScreen'
import { LoadingScreen } from './LoadingScreen'
import { PassengerDebugMode } from './PassengerDebugMode'
import { useCurrentPosition } from './position'
import { RequestFlow } from './RequestFlow'
import { loadFilters, saveFilters } from './savedFilters'
import { nearestPickup, searchFromProfile } from './search'
import { SubmitSheet } from './SubmitSheet'
import { SupplyScreen } from './SupplyScreen'

type View =
  /** `missing`: the backend answered 404, so it does not have this API yet (not a connection problem). */
  | { kind: 'loading'; failed: boolean; missing?: string }
  | { kind: 'setup' }
  | { kind: 'supply'; notice: string | null }
  | { kind: 'request'; request: PassengerRequest; fresh: boolean }

const isOpen = (r: PassengerRequest | null) => r !== null && (r.status === 'waiting_driver' || r.status === 'confirmed' || r.status === 'boarded')

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
  const myTags = useMyTags(api)
  const { presetId, setPresetId, position } = useCurrentPosition(pickupPoints)

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const [points, stops, profile, latest] = await Promise.all([
          api.get<PickupPoint[]>('/pickup-points'),
          api.get<BusStop[]>('/bus-stops'),
          api.get<PassengerProfile>('/passenger/profile'),
          api.get<PassengerRequestResponse>('/passenger/request'),
        ])
        if (cancelled) return
        const fromProfile = searchFromProfile(profile)
        const habitual = fromProfile && { ...fromProfile, tag_filters: loadFilters() }
        setPickupPoints(points)
        setBusStops(stops)
        setSearch(habitual)
        // An open request comes back after a reload; habitual data skips the setup (5, REQ-025).
        if (latest.request && isOpen(latest.request)) setView({ kind: 'request', request: latest.request, fresh: false })
        else setView(habitual ? { kind: 'supply', notice: null } : { kind: 'setup' })
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
      await api.post('/activities')
      api.post('/location', position).catch(() => undefined)
      const { request } = await api.post<PassengerRequestResponse>('/passenger/requests', { ...next, pickup_point_id: pickup.id, location: position })
      setSheetOpen(false)
      if (request) setView({ kind: 'request', request, fresh: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'request_active') {
        const { request } = await api.get<PassengerRequestResponse>('/passenger/request')
        setSheetOpen(false)
        if (request) setView({ kind: 'request', request, fresh: false })
      } else {
        setSubmitError(err instanceof ApiError && err.status < 500 ? err.message : '沒有送出成功，請再按一次。')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const backToSupply = useCallback((notice: string | null) => (setReporting(false), setView({ kind: 'supply', notice })), [])

  let screen
  if (view.kind === 'loading') {
    screen = <LoadingScreen failed={view.failed} missing={view.missing} />
  } else if (view.kind === 'request') {
    // Before the search checks: an open request comes back even without habitual data.
    screen = <RequestFlow key={view.request.id} initial={view.request} fresh={view.fresh} position={position} onBack={backToSupply} onOpenChange={setReporting} />
  } else if (view.kind === 'setup' || search === null || pickup === null) {
    screen = (
      <DestinationScreen
        initial={search}
        busStops={busStops}
        myTags={myTags}
        onDone={(s) => (setSearch(s), setView({ kind: 'supply', notice: null }))}
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
            tags={myTags.tags ?? []}
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
      {DEBUG && <PassengerDebugMode presetId={presetId} position={position} reporting={reporting} onPreset={setPresetId} />}
    </PhoneShell>
  )
}
