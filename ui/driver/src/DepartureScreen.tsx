import {
  ApiError,
  Button,
  ChipSelect,
  ErrorNote,
  PlaceSearch,
  RouteMap,
  RouteStrip,
  RouteStripSkeleton,
  SimulatedBadge,
  routeStripItems,
  summarizeFilters,
  TagFilterEditor,
  useMyTags,
  type DriverProfile,
  type PickupPoint,
  type Route,
  type TripDefaults,
  type TripView,
} from '@carpool/shared'
import { useEffect, useState } from 'react'
import { AccountTag } from './AccountTag'
import { CapacityStepper } from './CapacityStepper'
import { api } from './config'
import { draftFrom, hasDefaults, toSettings, type DepartureDraft } from './departureDraft'
import { PickupEditor } from './PickupEditor'
import { SettingLine, SettingRow } from './SettingRow'
import { Switch } from './Switch'

type Section = 'pickup' | 'destination' | 'filters' | 'tags'

interface DepartureScreenProps {
  onDeparted: (trip: TripView) => void
  /** Another departure is already running (409 already_active): show it. */
  onAlreadyActive: () => void
}

/** Last departure's settings, else the habitual profile (REQ-016); null when neither exists. */
async function loadDraft(): Promise<DepartureDraft | null> {
  const defaults = await api.get<TripDefaults>('/driver/trips/defaults').catch(() => null)
  if (hasDefaults(defaults)) return draftFrom(defaults, null)
  const profile = await api.get<DriverProfile>('/driver/profile').catch(() => null)
  return profile?.usual_destination ? draftFrom(null, profile) : null
}

/** 6.1: confirm today's settings and go. One tap when nothing changed (REQ-017). */
export function DepartureScreen({ onDeparted, onAlreadyActive }: DepartureScreenProps) {
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([])
  const [draft, setDraft] = useState<DepartureDraft>(() => draftFrom(null, null))
  const [loaded, setLoaded] = useState(false)
  const [firstTime, setFirstTime] = useState(false)
  const [open, setOpen] = useState<Section[]>([])
  const [route, setRoute] = useState<Route | null>(null)
  const [routeFailed, setRouteFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const myTags = useMyTags(api)

  useEffect(() => {
    api.get<PickupPoint[]>('/pickup-points').then(setPickupPoints, () => setError('讀不到上車點清單，請重新整理。'))
    loadDraft().then((prefill) => {
      if (prefill) setDraft(prefill)
      // Never departed: pickup point and destination start open (6.1).
      setFirstTime(prefill === null)
      setOpen(prefill === null ? ['pickup', 'destination'] : [])
      setLoaded(true)
    })
  }, [])

  const { pickupPointId, destination } = draft
  useEffect(() => {
    if (pickupPointId === null || destination === null) return setRoute(null)
    let cancelled = false
    api.post<Route>('/driver/route-preview', { pickup_point_id: pickupPointId, destination }).then(
      (r) => !cancelled && (setRoute(r), setRouteFailed(false)),
      () => !cancelled && setRouteFailed(true),
    )
    return () => {
      cancelled = true
    }
  }, [pickupPointId, destination])

  const pickup = pickupPoints.find((p) => p.id === draft.pickupPointId) ?? null
  const tags = myTags.tags ?? []
  const settings = toSettings(draft)
  const toggle = (s: Section) => setOpen((o) => (o.includes(s) ? o.filter((x) => x !== s) : [...o, s]))
  const close = (s: Section) => setOpen((o) => o.filter((x) => x !== s))
  const update = (change: Partial<DepartureDraft>) => setDraft((d) => ({ ...d, ...change }))

  async function depart() {
    if (!settings) return
    setSubmitting(true)
    setError(undefined)
    try {
      onDeparted(await api.post<TripView>('/driver/trips', settings))
    } catch (err) {
      if (err instanceof ApiError && err.code === 'already_active') return onAlreadyActive()
      setError(err instanceof ApiError && err.status < 500 ? err.message : '沒有出發成功，請再按一次。')
      setSubmitting(false)
    }
  }

  const strip = pickup && destination && route ? routeStripItems(pickup.name, route.bus_stops, destination.name) : null

  return (
    <div className="relative h-full bg-white">
      <div className="absolute inset-x-0 top-0 h-[44%]">
        <RouteMap pickup={pickup} destination={destination} route={route} padding={{ top: 72, right: 40, bottom: 56, left: 40 }} />
      </div>
      <AccountTag />

      <div className="pointer-events-none absolute inset-x-0 top-(--safe-top) bottom-0 overflow-y-auto overscroll-contain">
        <div className="h-[34%]" />
        <section className="pointer-events-auto min-h-[62%] rounded-t-sheet bg-white px-6 pt-7 pb-[calc(var(--safe-bottom)+112px)] shadow-[0_-12px_32px_-16px_color-mix(in_srgb,var(--color-ink)_40%,transparent)]">
          <h1 className="text-[32px]/tight font-bold">{firstTime ? '第一次出發' : '今天載人嗎？'}</h1>
          <p className="mt-1 text-lg text-ink-soft">{firstTime ? '選好上車點和目的地就能出發，下次會自動帶入。' : '設定沿用上次。沒問題就出發。'}</p>

          <div className="mt-6">
            {!loaded || (strip === null && settings !== null && !routeFailed) ? (
              <RouteStripSkeleton />
            ) : strip ? (
              <>
                <RouteStrip items={strip.items} />
                <p className="mt-3 flex items-center gap-2 pl-9 text-sm text-ink-soft">
                  <SimulatedBadge label="路線為估算" />
                  {strip.hidden > 0 && <span>沿途共 {strip.items.length - 2 + strip.hidden} 個公車站</span>}
                </p>
              </>
            ) : (
              <p className="text-base text-ink-soft">{routeFailed ? '路線畫不出來，還是可以出發。' : '今天的路線會畫在這裡。'}</p>
            )}
          </div>

          <div className="mt-6 border-t border-rule">
            <SettingRow label="上車點" value={pickup?.name ?? '未選'} open={open.includes('pickup')} onToggle={() => toggle('pickup')}>
              <PickupEditor
                pickupPoints={pickupPoints}
                value={draft.pickupPointId}
                onChange={(id) => (update({ pickupPointId: id }), close('pickup'))}
              />
            </SettingRow>
            <SettingRow label="目的地" value={destination?.name ?? '未填'} open={open.includes('destination')} onToggle={() => toggle('destination')}>
              <PlaceSearch api={api} value={destination} onChange={(place) => (update({ destination: place }), close('destination'))} />
            </SettingRow>
            <SettingLine label="可載人數">
              <CapacityStepper value={draft.capacity} onChange={(capacity) => update({ capacity })} />
            </SettingLine>
            <SettingLine label="自動接受">
              <Switch label="自動接受搭車請求" checked={draft.autoAccept} onChange={(autoAccept) => update({ autoAccept })} />
            </SettingLine>
            <SettingRow label="篩選乘客" value={summarizeFilters(tags, draft.tagFilters)} open={open.includes('filters')} onToggle={() => toggle('filters')}>
              <TagFilterEditor tags={tags} value={draft.tagFilters} onChange={(tagFilters) => update({ tagFilters })} />
              <p className="mt-2 text-sm text-ink-soft">強制：不符合的乘客不會配給你。建議：只供參考，不影響配對。</p>
            </SettingRow>
            <SettingRow
              label="我的標籤"
              value={tags.filter((t) => t.selected).map((t) => t.name).join('、') || '未選'}
              open={open.includes('tags')}
              onToggle={() => toggle('tags')}
            >
              <ChipSelect label="我的標籤" options={tags.map((t) => ({ id: t.id, label: t.name }))} selected={tags.filter((t) => t.selected).map((t) => t.id)} onToggle={myTags.toggle} />
              <p className="mt-2 text-sm text-ink-soft">乘客篩選駕駛時會看這些標籤。</p>
            </SettingRow>
          </div>
          {myTags.error && (
            <div className="mt-4">
              <ErrorNote>{myTags.error}</ErrorNote>
            </div>
          )}
        </section>
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white from-70% to-transparent px-6 pt-8 pb-[calc(var(--safe-bottom)+12px)]">
        {error && (
          <div className="mb-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        <Button className="h-16 w-full text-xl" disabled={!loaded || !settings || submitting} onClick={depart}>
          {submitting ? '出發中…' : '我出發了'}
        </Button>
      </div>
    </div>
  )
}
