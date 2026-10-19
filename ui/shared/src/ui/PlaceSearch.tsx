import { useEffect, useState } from 'react'
import type { ApiClient } from '../api/client'
import type { Place } from '../api/types'

const SEARCH_DELAY_MS = 250

interface PlaceSearchProps {
  api: ApiClient
  value: Place | null
  onChange: (place: Place) => void
}

/** Address field with matches inside the park (GET /api/places). */
export function PlaceSearch({ api, value, onChange }: PlaceSearchProps) {
  const [query, setQuery] = useState(value?.name ?? '')
  const [results, setResults] = useState<Place[]>([])
  const [failed, setFailed] = useState(false)
  // Matches are listed while typing; a chosen place closes the list.
  const [editing, setEditing] = useState(value === null)

  useEffect(() => {
    if (!editing) return
    let cancelled = false
    const timer = setTimeout(() => {
      api.get<Place[]>(`/places?q=${encodeURIComponent(query.trim())}`).then(
        (places) => !cancelled && (setResults(places), setFailed(false)),
        () => !cancelled && setFailed(true),
      )
    }, SEARCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [api, query, editing])

  const choose = (p: Place) => {
    setQuery(p.name)
    setEditing(false)
    onChange(p)
  }

  return (
    <div>
      <input
        type="search"
        aria-label="目的地地址"
        value={query}
        placeholder="輸入內科的地址或公車站"
        onChange={(e) => (setQuery(e.target.value), setEditing(true))}
        onFocus={() => setEditing(true)}
        className="h-14 w-full rounded-control bg-white px-4 text-lg ring-1 ring-rule outline-none ring-inset placeholder:text-ink-soft focus-visible:outline-3 focus-visible:outline-brand"
      />
      {failed && <p className="mt-2 text-sm text-danger">搜尋不到，請檢查網路再試一次。</p>}
      <ul aria-label="符合的地點" className="mt-1">
        {(editing ? results : []).map((p) => (
          <li key={p.name}>
            <button type="button" onClick={() => choose(p)} className="flex h-12 w-full items-center gap-3 text-left text-lg">
              <span aria-hidden className="size-3.5 rounded-[2px] bg-brand" />
              <span className={p.name === value?.name ? 'font-semibold' : ''}>{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
