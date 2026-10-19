import type { TagFilter, TagIntent } from '../api/types'

type Choice = TagIntent | 'none'

const CHOICES: { value: Choice; label: string; on: string }[] = [
  { value: 'none', label: '不限', on: 'bg-white text-ink shadow-sm' },
  { value: 'preferred', label: '建議', on: 'bg-brand text-white' },
  { value: 'required', label: '強制', on: 'bg-ink text-white' },
]

interface TagFilterEditorProps {
  tags: { id: number; name: string }[]
  value: TagFilter[]
  onChange: (next: TagFilter[]) => void
}

/** One row per tag with a 不限／建議／強制 switch; same control for drivers and passengers (UD-06). */
export function TagFilterEditor({ tags, value, onChange }: TagFilterEditorProps) {
  const intentOf = (id: number): Choice => value.find((f) => f.tag_id === id)?.intent ?? 'none'
  const set = (id: number, choice: Choice) => {
    const others = value.filter((f) => f.tag_id !== id)
    onChange(choice === 'none' ? others : [...others, { tag_id: id, intent: choice }])
  }
  return (
    <ul className="divide-y divide-rule">
      {tags.map((tag) => (
        <li key={tag.id} className="flex items-center justify-between gap-3 py-2">
          <span className="text-base">{tag.name}</span>
          <span role="radiogroup" aria-label={`${tag.name}的篩選`} className="flex rounded-control bg-paper p-1">
            {CHOICES.map((c) => {
              const on = intentOf(tag.id) === c.value
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set(tag.id, c.value)}
                  className={`h-10 min-w-14 rounded-[12px] px-3 text-base font-semibold ${on ? c.on : 'text-ink-soft'}`}
                >
                  {c.label}
                </button>
              )
            })}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Collapsed value of a filter setting, e.g. 強制：不抽菸 (UD-02). */
export function summarizeFilters(tags: { id: number; name: string }[], value: TagFilter[]): string {
  const names = (intent: TagIntent) => value.filter((f) => f.intent === intent).map((f) => tags.find((t) => t.id === f.tag_id)?.name ?? '')
  const parts = [
    names('required').length ? `強制：${names('required').join('、')}` : '',
    names('preferred').length ? `建議：${names('preferred').join('、')}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join('；') : '不限'
}
