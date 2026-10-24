import { useCallback, useRef, useState } from 'react'

/** Only the latest entries are kept; a reload clears them (UD-30 part 2). */
export const LOG_LIMIT = 50

export interface LogEntry {
  id: number
  /** Wall-clock 時:分:秒, not the status bar's 08:12 (UD-30). */
  time: string
  text: string
  error: boolean
}

export type AddLog = (text: string, error?: boolean) => void

/** A new list with the entry last (newest at the bottom), trimmed to the latest LOG_LIMIT. */
export function appendEntry(entries: LogEntry[], entry: LogEntry): LogEntry[] {
  return [...entries, entry].slice(-LOG_LIMIT)
}

export const clockTime = (date: Date) => date.toLocaleTimeString('zh-TW', { hourCycle: 'h23' })

let nextId = 1

/**
 * The speaker's log (UD-30 part 2): never opens by itself; an error while it is closed lights the dot
 * until the speaker opens it.
 */
export function useLog() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [open, setOpen] = useState(false)
  const [unseenError, setUnseenError] = useState(false)
  // A ref, so `add` stays the same function for the off-stage loop that holds it.
  const openRef = useRef(false)

  const add = useCallback<AddLog>((text, error = false) => {
    setEntries((list) => appendEntry(list, { id: nextId++, time: clockTime(new Date()), text, error }))
    if (error && !openRef.current) setUnseenError(true)
  }, [])
  const show = useCallback(() => {
    openRef.current = true
    setOpen(true)
    setUnseenError(false)
  }, [])
  const hide = useCallback(() => {
    openRef.current = false
    setOpen(false)
  }, [])

  return { entries, open, unseenError, add, show, hide }
}
