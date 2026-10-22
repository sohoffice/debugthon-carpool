import type { Tag, TagFilter } from '@carpool/shared'
import { account } from './config'

const storageKey = `carpool.filters.${account}`

const isFilter = (f: unknown): f is TagFilter =>
  typeof f === 'object' && f !== null && typeof (f as TagFilter).tag_id === 'number' &&
  ((f as TagFilter).intent === 'required' || (f as TagFilter).intent === 'preferred')

/**
 * The passenger's tag filters, remembered in this browser only: habitual data from the backend
 * keeps the destination and stops (DD-19), not the filters (docs/ui-design.md 7.1).
 */
export function loadFilters(): TagFilter[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isFilter) : []
  } catch {
    return []
  }
}

export function saveFilters(filters: TagFilter[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(filters))
  } catch {
    // Private mode: the filters just are not remembered.
  }
}

/**
 * Drops remembered filters on tags a passenger cannot filter by: tags no longer in the list
 * (女性友善) or not applying to drivers. The backend refuses those with 400 on the supply query and
 * the request (REQ-085, DD-42). Run once the tag list is known, before anything reads the filters.
 */
export function dropUnusableFilters(tags: Tag[]) {
  const usable = new Set(tags.filter((t) => t.filter_label !== null).map((t) => t.id))
  const filters = loadFilters()
  const kept = filters.filter((f) => usable.has(f.tag_id))
  if (kept.length !== filters.length) saveFilters(kept)
}
