import type { TagFilter, TagIntent } from '../api/types'
import { Switch } from './Switch'

type Choice = TagIntent | 'none'

/** What the caller calls each intent, e.g. the passenger's 不在意／最好／一定要 (UD-06). */
export type IntentLabels = Record<Choice, string>

/** One row of the editor: the tag in the wording for filtering the other side (REQ-086, DD-42). */
export interface FilterTag {
  id: number
  label: string
}

const CHOICES: { value: Choice; on: string }[] = [
  { value: 'none', on: 'bg-surface text-fg ring-1 ring-inset ring-line' },
  { value: 'preferred', on: 'bg-accent text-on-accent' },
  { value: 'required', on: 'bg-fg text-canvas' },
]

interface TagFilterEditorProps {
  tags: FilterTag[]
  value: TagFilter[]
  onChange: (next: TagFilter[]) => void
  /** A three-way switch per tag with these words; without them each tag is an on/off switch, on = required (REQ-013). */
  intentLabels?: IntentLabels
}

/** One row per tag: the passenger's 不在意／最好／一定要, or the driver's 只載 switches (UD-06). */
export function TagFilterEditor({ tags, value, onChange, intentLabels }: TagFilterEditorProps) {
  const intentOf = (id: number): Choice => value.find((f) => f.tag_id === id)?.intent ?? 'none'
  const set = (id: number, choice: Choice) => {
    const others = value.filter((f) => f.tag_id !== id)
    onChange(choice === 'none' ? others : [...others, { tag_id: id, intent: choice }])
  }
  return (
    <ul className="divide-y divide-line">
      {tags.map((tag) => (
        <li key={tag.id} className="flex items-center justify-between gap-3 py-2">
          <span className="text-base">{tag.label}</span>
          {intentLabels ? (
            <span role="radiogroup" aria-label={`${tag.label}的篩選`} className="flex rounded-control bg-sunk p-1">
              {CHOICES.map((c) => {
                const on = intentOf(tag.id) === c.value
                return (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set(tag.id, c.value)}
                    className={`h-10 min-w-14 rounded-[12px] px-3 text-base font-semibold ${on ? c.on : 'text-fg-soft'}`}
                  >
                    {intentLabels[c.value]}
                  </button>
                )
              })}
            </span>
          ) : (
            <Switch label={tag.label} checked={intentOf(tag.id) === 'required'} onChange={(on) => set(tag.id, on ? 'required' : 'none')} />
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * Collapsed value of the driver's 只載 (UD-02): the tags that are on, e.g. 不抽菸的乘客, with no
 * intent since a driver's filter is always required (REQ-013). 不限 when none is on.
 */
export function summarizeFilters(tags: FilterTag[], value: TagFilter[]): string {
  const on = value.filter((f) => f.intent === 'required').flatMap((f) => tags.find((t) => t.id === f.tag_id)?.label ?? [])
  return on.join('、') || '不限'
}

/** The tags the caller may filter the other side by, in that wording (REQ-085, DD-42). */
export function filterTags(tags: { id: number; filter_label: string | null }[]): FilterTag[] {
  return tags.flatMap((t) => (t.filter_label ? [{ id: t.id, label: t.filter_label }] : []))
}

/** The tags the caller may describe themselves with, in that wording (REQ-008, DD-42). */
export function selfTags(tags: { id: number; self_label: string | null }[]): FilterTag[] {
  return tags.flatMap((t) => (t.self_label ? [{ id: t.id, label: t.self_label }] : []))
}
