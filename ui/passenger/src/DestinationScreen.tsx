import {
  Button,
  ChipSelect,
  CompanyChip,
  distanceM,
  ErrorNote,
  filterTags,
  PlaceSearch,
  selfTags,
  TagFilterEditor,
  type BusStop,
  type PassengerSearch,
  type Place,
  type Tag,
  type TagFilter,
} from '@carpool/shared'
import { useState } from 'react'
import { api } from './config'
import { INTENT_LABELS } from './intentLabels'
import { loadFilters } from './savedFilters'

/** Stops within this walk of the destination are offered (no walking-time suggestion: REQ-026 is Phase 2). */
const NEARBY_STOP_M = 1000
const MAX_STOP_NAMES = 8

interface DestinationScreenProps {
  initial: PassengerSearch | null
  busStops: BusStop[]
  myTags: { tags: Tag[] | undefined; error: string | undefined; toggle: (id: number) => void }
  onDone: (search: PassengerSearch) => void
  /** Commute info on the pickup point chosen now (DD-38, SC-X4). */
  onOpenCommute: () => void
}

/** Park stops near the destination, one chip per name (both sides of a road), nearest first, plus any already chosen. */
function stopChoices(busStops: BusStop[], destination: Place | null, chosen: number[]) {
  const byName = new Map<string, { ids: number[]; distance: number }>()
  for (const s of busStops) {
    const d = destination ? distanceM(s, destination) : 0
    const entry = byName.get(s.name) ?? { ids: [], distance: Number.POSITIVE_INFINITY }
    byName.set(s.name, { ids: [...entry.ids, s.id], distance: Math.min(entry.distance, d) })
  }
  return [...byName.entries()]
    .map(([name, v], i) => ({ name, chipId: i, ...v }))
    .filter((c) => (destination !== null && c.distance <= NEARBY_STOP_M) || c.ids.some((id) => chosen.includes(id)))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(MAX_STOP_NAMES, chosen.length))
}

/** 7.1: where in the park, where else the passenger may get off, own tags and filters (UD-06). */
export function DestinationScreen({ initial, busStops, myTags, onDone, onOpenCommute }: DestinationScreenProps) {
  const [destination, setDestination] = useState<Place | null>(initial?.destination ?? null)
  const [stopIds, setStopIds] = useState<number[]>(initial?.accepted_stop_ids ?? [])
  const [filters, setFilters] = useState<TagFilter[]>(initial?.tag_filters ?? loadFilters())
  const tags = myTags.tags ?? []
  const choices = stopChoices(busStops, destination, stopIds)
  const selectedChips = choices.filter((c) => c.ids.some((id) => stopIds.includes(id))).map((c) => c.chipId)
  const toggleStop = (chipId: number) => {
    const chip = choices.find((c) => c.chipId === chipId)
    if (!chip) return
    const on = chip.ids.some((id) => stopIds.includes(id))
    setStopIds((ids) => (on ? ids.filter((id) => !chip.ids.includes(id)) : [...ids, ...chip.ids]))
  }
  const ready = destination !== null && stopIds.length > 0

  return (
    <div className="relative h-full bg-canvas">
      <main className="h-full overflow-y-auto overscroll-contain px-6 pt-[calc(var(--safe-top)+24px)] pb-[calc(var(--safe-bottom)+112px)]">
        <h1 className="text-[34px]/tight font-semibold">要去內科哪裡？</h1>
        <p className="mt-1 text-lg text-fg-soft">用來找順路的車，下次會自動帶入。</p>

        <h2 className="mt-8 text-base font-semibold text-fg-soft">目的地地址</h2>
        <div className="mt-2">
          <PlaceSearch api={api} value={destination} onChange={setDestination} />
        </div>

        <h2 className="mt-6 text-base font-semibold text-fg-soft">也可以在這些公車站下車</h2>
        <p className="mt-1 text-sm text-fg-soft">至少選一站，再走路到目的地。</p>
        <div className="mt-3">
          {choices.length > 0 ? (
            <ChipSelect label="可以下車的公車站" options={choices.map((c) => ({ id: c.chipId, label: c.name }))} selected={selectedChips} onToggle={toggleStop} />
          ) : (
            <p className="text-base text-fg-soft">{destination ? '附近沒有園區內的公車站。' : '先填目的地，這裡會列出附近的公車站。'}</p>
          )}
        </div>

        <h2 className="mt-8 text-base font-semibold text-fg-soft">關於我</h2>
        <div className="mt-3">
          <ChipSelect label="關於我" options={selfTags(tags)} selected={tags.filter((t) => t.selected).map((t) => t.id)} onToggle={myTags.toggle} />
        </div>
        <p className="mt-2 text-sm text-fg-soft">有些駕駛只載符合條件的乘客。符合的都標上，配得到的車會比較多。</p>

        <h2 className="mt-8 text-base font-semibold text-fg-soft">這趟車要</h2>
        {/* Simulated and never sent in the filters (DD-43). */}
        <div className="mt-3">
          <CompanyChip label="同企業" />
        </div>
        <div className="mt-1">
          <TagFilterEditor tags={filterTags(tags)} value={filters} onChange={setFilters} intentLabels={INTENT_LABELS} />
        </div>
        <p className="mt-2 text-sm text-fg-soft">一定要：沒有這樣的車就不配。最好：盡量配到，沒有就照常配。</p>
        {myTags.error && (
          <div className="mt-4">
            <ErrorNote>{myTags.error}</ErrorNote>
          </div>
        )}

        {/* Under the settings, over the main button, and quieter than it (SC-X4). */}
        <button type="button" onClick={onOpenCommute} className="mt-6 flex w-full items-center gap-3 rounded-control bg-paper px-4 py-3.5 text-left">
          <span aria-hidden className="grid shrink-0 grid-cols-[repeat(4,7px)] gap-[2px]">
            {['bg-ride-2', 'bg-ride-4', 'bg-ride-6', 'bg-ride-3', 'bg-ride-5', 'bg-ride-6', 'bg-ride-4', 'bg-ride-2'].map((c, i) => (
              <i key={i} className={`h-[7px] rounded-[1px] ${c}`} />
            ))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">通勤資訊</span>
            <span className="block text-sm/snug text-fg-soft">過去 10 天這個上車點載客幾次、路上塞不塞</span>
          </span>
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="size-5 shrink-0 text-fg-soft">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </main>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-canvas from-70% to-transparent px-6 pt-8 pb-[calc(var(--safe-bottom)+12px)]">
        <Button
          className="h-16 w-full text-xl"
          disabled={!ready}
          onClick={() => destination && onDone({ destination, accepted_stop_ids: stopIds, tag_filters: filters })}
        >
          查看接近的車
        </Button>
      </div>
    </div>
  )
}
