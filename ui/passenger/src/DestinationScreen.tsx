import {
  Button,
  ChipSelect,
  distanceM,
  ErrorNote,
  PlaceSearch,
  TagFilterEditor,
  type BusStop,
  type PassengerSearch,
  type Place,
  type Tag,
  type TagFilter,
} from '@carpool/shared'
import { useState } from 'react'
import { api } from './config'

/** Stops within this walk of the destination are offered (no walking-time suggestion: REQ-026 is Phase 2). */
const NEARBY_STOP_M = 1000
const MAX_STOP_NAMES = 8

interface DestinationScreenProps {
  initial: PassengerSearch | null
  busStops: BusStop[]
  myTags: { tags: Tag[] | undefined; error: string | undefined; toggle: (id: number) => void }
  onDone: (search: PassengerSearch) => void
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

/** 7.1: where in the park, where else the passenger may get off, filters and own tags. */
export function DestinationScreen({ initial, busStops, myTags, onDone }: DestinationScreenProps) {
  const [destination, setDestination] = useState<Place | null>(initial?.destination ?? null)
  const [stopIds, setStopIds] = useState<number[]>(initial?.accepted_stop_ids ?? [])
  const [filters, setFilters] = useState<TagFilter[]>(initial?.tag_filters ?? [])
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
    <div className="relative h-full bg-paper">
      <main className="h-full overflow-y-auto overscroll-contain px-6 pt-[calc(var(--safe-top)+24px)] pb-[calc(var(--safe-bottom)+112px)]">
        <h1 className="text-[32px]/tight font-bold">要去內科哪裡？</h1>
        <p className="mt-1 text-lg text-ink-soft">用來找順路的車，下次會自動帶入。</p>

        <h2 className="mt-8 text-base font-semibold text-ink-soft">目的地地址</h2>
        <div className="mt-2">
          <PlaceSearch api={api} value={destination} onChange={setDestination} />
        </div>

        <h2 className="mt-6 text-base font-semibold text-ink-soft">也可以在這些公車站下車</h2>
        <p className="mt-1 text-sm text-ink-soft">至少選一站，再走路到目的地。</p>
        <div className="mt-3">
          {choices.length > 0 ? (
            <ChipSelect label="可以下車的公車站" options={choices.map((c) => ({ id: c.chipId, label: c.name }))} selected={selectedChips} onToggle={toggleStop} />
          ) : (
            <p className="text-base text-ink-soft">{destination ? '附近沒有園區內的公車站。' : '先填目的地，這裡會列出附近的公車站。'}</p>
          )}
        </div>

        <h2 className="mt-8 text-base font-semibold text-ink-soft">篩選駕駛</h2>
        <div className="mt-1">
          <TagFilterEditor tags={tags} value={filters} onChange={setFilters} />
        </div>
        <p className="mt-2 text-sm text-ink-soft">強制：不符合就不配對。建議：盡量配對符合的駕駛，沒有時照常配對。</p>

        <h2 className="mt-8 text-base font-semibold text-ink-soft">我的標籤</h2>
        <div className="mt-3">
          <ChipSelect label="我的標籤" options={tags.map((t) => ({ id: t.id, label: t.name }))} selected={tags.filter((t) => t.selected).map((t) => t.id)} onToggle={myTags.toggle} />
        </div>
        {myTags.error && (
          <div className="mt-4">
            <ErrorNote>{myTags.error}</ErrorNote>
          </div>
        )}
      </main>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-paper from-70% to-transparent px-6 pt-8 pb-[calc(var(--safe-bottom)+12px)]">
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
