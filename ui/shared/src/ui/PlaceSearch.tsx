import { useEffect, useState } from 'react'
import type { ApiClient } from '../api/client'
import type { ParkCheck, Place } from '../api/types'
import { PlacesAttribution } from '../map/PlacesAttribution'
import { usePlaceSearch, type PlaceSuggestion } from '../map/usePlaceSearch'

const SEARCH_DELAY_MS = 250

interface PlaceSearchProps {
  api: ApiClient
  value: Place | null
  onChange: (place: Place) => void
}

/**
 * Address field searched with Google Places (DD-32). A chosen place is checked against the park
 * at once; one outside is not taken, like the backend refuses it on departure or request (REQ-001).
 */
export function PlaceSearch({ api, value, onChange }: PlaceSearchProps) {
  const searcher = usePlaceSearch()
  const [query, setQuery] = useState(value?.name ?? '')
  const [results, setResults] = useState<PlaceSuggestion[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // Matches are listed while typing; a chosen place closes the list.
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!editing || q === '') return setResults((r) => (r.length ? [] : r))
    if (!searcher) return setNote('目前無法搜尋地點，可以沿用已帶入的目的地。')
    let cancelled = false
    const timer = setTimeout(() => {
      searcher.suggest(q).then(
        (found) => !cancelled && (setResults(found), setNote(found.length ? null : '找不到這個地點，換個名稱或地址試試。')),
        () => !cancelled && setNote('搜尋不到，請檢查網路再試一次。'),
      )
    }, SEARCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searcher, query, editing])

  async function choose(s: PlaceSuggestion) {
    setChecking(true)
    setNote(null)
    try {
      const place = await s.resolve()
      // A failed check takes the place anyway: the backend checks again on departure or request.
      const check = await api.get<ParkCheck>(`/park/check?lat=${place.lat}&lng=${place.lng}`).catch(() => null)
      if (check?.inside === false) return setNote(`${place.name}不在內湖科學園區內，請換一個地點。`)
      setQuery(place.name)
      setEditing(false)
      onChange(place)
    } catch {
      setNote('讀不到這個地點，請再選一次。')
    } finally {
      setChecking(false)
    }
  }

  const shown = editing ? results : []

  return (
    <div>
      <input
        type="search"
        aria-label="目的地地址"
        value={query}
        placeholder="輸入內科的地點名稱或地址"
        onChange={(e) => (setQuery(e.target.value), setEditing(true), setNote(null))}
        className="h-14 w-full rounded-control bg-surface px-4 text-lg text-fg ring-[1.5px] ring-line outline-none ring-inset placeholder:text-fg-soft focus-visible:outline-3 focus-visible:outline-accent"
      />
      {note && (
        <p role="status" className="mt-2 text-sm text-alert">
          {note}
        </p>
      )}
      <ul aria-label="符合的地點" className="mt-1">
        {shown.map((s) => (
          <li key={s.id}>
            <button type="button" disabled={checking} onClick={() => choose(s)} className="flex min-h-12 w-full items-center gap-3 py-1 text-left disabled:opacity-60">
              <span aria-hidden className="size-3.5 shrink-0 rounded-[2px] bg-route" />
              <span className="min-w-0">
                <span className="block text-lg">{s.name}</span>
                {s.detail && <span className="block truncate text-sm text-fg-soft">{s.detail}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {/* Suggestions come from Google Places and need its attribution (DD-32). */}
      {shown.length > 0 && <PlacesAttribution />}
    </div>
  )
}
