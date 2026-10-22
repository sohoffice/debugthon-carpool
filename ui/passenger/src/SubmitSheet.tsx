import { Button, ChipSelect, CompanyChip, ErrorNote, filterTags, selfTags, TagFilterEditor, type Tag, type TagFilter } from '@carpool/shared'
import { useState } from 'react'
import { INTENT_LABELS } from './intentLabels'

interface SubmitSheetProps {
  myTags: { tags: Tag[] | undefined; error: string | undefined; toggle: (id: number) => void }
  filters: TagFilter[]
  submitting: boolean
  error: string | null
  onSubmit: (filters: TagFilter[]) => void
  onClose: () => void
}

/** 7.3: filters can still be changed before sending (REQ-035); one more step against pocket taps (UD-08). */
export function SubmitSheet({ myTags, filters, submitting, error, onSubmit, onClose }: SubmitSheetProps) {
  const [value, setValue] = useState(filters)
  const [editingAbout, setEditingAbout] = useState(false)
  const tags = myTags.tags ?? []
  // The passenger's own wording, passenger tags only (REQ-008, REQ-086, DD-42).
  const about = selfTags(tags)
  const selected = tags.filter((t) => t.selected).map((t) => t.id)
  const summary = about.filter((t) => selected.includes(t.id)).map((t) => t.label).join('、') || '不限'
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <button type="button" aria-label="關閉" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-ink/45" />
      <section
        role="dialog"
        aria-label="送出搭車請求"
        className="relative max-h-[86%] overflow-y-auto rounded-t-sheet bg-canvas px-6 pt-7 pb-[calc(var(--safe-bottom)+12px)]"
      >
        <h2 className="text-[30px]/tight font-semibold">送出搭車請求</h2>
        <p className="mt-1 text-lg text-fg-soft">平台會替你分配一台最快能送你到的車。</p>
        {/* Saved to the passenger's tags at once, so this request is matched on them (REQ-040). */}
        <div className="mt-6 rounded-control bg-surface px-4 py-3 ring-[1.5px] ring-inset ring-line">
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-base font-semibold text-fg-soft">關於我</span>
            <span className="min-w-0 flex-1 truncate text-base">
              {summary}
            </span>
            <button
              type="button"
              aria-expanded={editingAbout}
              onClick={() => setEditingAbout((on) => !on)}
              className="-my-2 min-h-11 shrink-0 px-1 text-base font-semibold text-accent"
            >
              修改
            </button>
          </div>
          {editingAbout && (
            <div className="mt-3">
              <ChipSelect label="關於我" options={about} selected={selected} onToggle={myTags.toggle} />
            </div>
          )}
        </div>
        {myTags.error && (
          <div className="mt-3">
            <ErrorNote>{myTags.error}</ErrorNote>
          </div>
        )}
        <h3 className="mt-6 text-base font-semibold text-fg-soft">這趟車要</h3>
        {/* Simulated and never sent in the filters (DD-43). */}
        <div className="mt-3">
          <CompanyChip label="同企業" />
        </div>
        <div className="mt-1">
          <TagFilterEditor tags={filterTags(tags)} value={value} onChange={setValue} intentLabels={INTENT_LABELS} />
        </div>
        {error && (
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        <div className="mt-6 flex flex-col gap-3">
          <Button className="h-16 text-xl" disabled={submitting} onClick={() => onSubmit(value)}>
            {submitting ? '送出中…' : '送出請求'}
          </Button>
          <Button variant="secondary" disabled={submitting} onClick={onClose}>
            先不要
          </Button>
        </div>
      </section>
    </div>
  )
}
