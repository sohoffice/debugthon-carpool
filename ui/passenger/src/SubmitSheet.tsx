import { Button, CompanyChip, ErrorNote, filterTags, TagFilterEditor, type Tag, type TagFilter } from '@carpool/shared'
import { useState } from 'react'
import { INTENT_LABELS } from './intentLabels'

interface SubmitSheetProps {
  tags: Tag[]
  filters: TagFilter[]
  submitting: boolean
  error: string | null
  onSubmit: (filters: TagFilter[]) => void
  onClose: () => void
}

/** 7.3: filters can still be changed before sending (REQ-035); one more step against pocket taps (UD-08). */
export function SubmitSheet({ tags, filters, submitting, error, onSubmit, onClose }: SubmitSheetProps) {
  const [value, setValue] = useState(filters)
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
