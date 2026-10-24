import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { LOG_LIMIT, type LogEntry } from './log'

/** Within this of the bottom counts as at the bottom: a new entry scrolls the list along. */
const AT_BOTTOM_PX = 8

/**
 * UD-30 part 2: the open log. Newest at the bottom; it follows new entries unless the speaker has
 * scrolled up. Not a dialog: nothing is trapped, Esc or ✕ closes it.
 */
export function LogPanel({ entries, onClose }: { entries: LogEntry[]; onClose: () => void }) {
  const list = useRef<HTMLOListElement>(null)
  const atBottom = useRef(true)
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => close.current?.focus(), [])
  // On open and on every new entry while at the bottom.
  useLayoutEffect(() => {
    const el = list.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [entries])

  function onScroll() {
    const el = list.current
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose()
  }

  return (
    <section
      aria-labelledby="log-title"
      onKeyDown={onKeyDown}
      className="flex max-h-[50dvh] w-[360px] flex-col rounded-[8px] border border-rule bg-surface shadow-lg shadow-ink/10"
    >
      <header className="flex h-11 shrink-0 items-center border-b border-rule pl-4">
        <h2 id="log-title" className="text-base font-semibold text-ink">
          紀錄
        </h2>
        <span className="ml-2 text-sm text-ink-soft">最近 {LOG_LIMIT} 筆</span>
        <button ref={close} type="button" aria-label="收起紀錄" onClick={onClose} className="ml-auto flex size-11 items-center justify-center text-xl text-ink-soft hover:text-ink">
          ✕
        </button>
      </header>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-[15px] text-ink-soft">還沒有紀錄。</p>
      ) : (
        <ol ref={list} onScroll={onScroll} aria-label="紀錄" className="min-h-0 flex-1 overflow-y-auto py-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              data-error={entry.error || undefined}
              className={`grid grid-cols-[auto_1fr] items-baseline gap-x-3 py-1.5 pr-4 ${entry.error ? 'border-l-4 border-danger pl-3' : 'pl-4'}`}
            >
              <time className="text-sm text-ink-soft tabular-nums">{entry.time}</time>
              <span className={`text-[15px] leading-snug ${entry.error ? 'font-medium text-danger' : 'text-ink'}`}>{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
