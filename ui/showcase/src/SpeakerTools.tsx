import { useEffect, useRef } from 'react'
import { LogButton } from './LogButton'
import { LogPanel } from './LogPanel'
import type { LogEntry } from './log'
import { ViewSwitch, type View } from './ViewSwitch'

interface SpeakerToolsProps {
  view: View
  onView: (view: View) => void
  entries: LogEntry[]
  open: boolean
  unseenError: boolean
  onOpen: () => void
  onClose: () => void
}

/**
 * UD-30 parts 2 and 3: the speaker's tools, fixed at the window's bottom right and never scaled.
 * 4px from the bottom on both views, so they sit centred in the war room's 44px bar and do not move
 * under the pointer when switching.
 */
export function SpeakerTools({ view, onView, entries, open, unseenError, onOpen, onClose }: SpeakerToolsProps) {
  const logButton = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(open)
  // Closing hands focus back to 紀錄, which replaced the panel.
  useEffect(() => {
    if (wasOpen.current && !open) logButton.current?.focus()
    wasOpen.current = open
  }, [open])

  return (
    <div className="fixed right-4 bottom-1 z-50 flex items-end gap-4">
      <ViewSwitch value={view} onChange={onView} />
      {open ? <LogPanel entries={entries} onClose={onClose} /> : <LogButton ref={logButton} unseenError={unseenError} onOpen={onOpen} />}
    </div>
  )
}
