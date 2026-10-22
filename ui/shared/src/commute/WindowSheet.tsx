import { useState } from 'react'
import { Button } from '../ui/Button'
import { CommuteSheet } from './CommuteSheet'
import { formatMinutes, SLOT_MINUTES, WINDOW_END, WINDOW_START, type SlotWindow } from './slots'

/** Start 07:00-09:45, end 07:15-10:00, both on 15-minute marks; the end frames through 09:45 (SC-X4). */
const STARTS = Array.from({ length: (WINDOW_END - WINDOW_START) / SLOT_MINUTES }, (_, i) => WINDOW_START + i * SLOT_MINUTES)
const ENDS = STARTS.map((m) => m + SLOT_MINUTES)

/** "點「時段」打開底部面板": pick a start and an end, start before end (SC-X4). */
export function WindowSheet({ value, onDone, onClose }: { value: SlotWindow; onDone: (w: SlotWindow) => void; onClose: () => void }) {
  const [from, setFrom] = useState(value.from)
  const [to, setTo] = useState(value.to)
  return (
    <CommuteSheet title="選擇時段" onClose={onClose}>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <TimeColumn label="開始" times={STARTS} value={from} isDisabled={() => false} onPick={(m) => (setFrom(m), m >= to && setTo(m + SLOT_MINUTES))} />
        <TimeColumn label="結束" times={ENDS} value={to} isDisabled={(m) => m <= from} onPick={setTo} />
      </div>
      <Button className="mt-5 w-full" onClick={() => onDone({ from, to })}>
        {`看 ${formatMinutes(from)}–${formatMinutes(to)}`}
      </Button>
    </CommuteSheet>
  )
}

function TimeColumn({
  label,
  times,
  value,
  isDisabled,
  onPick,
}: {
  label: string
  times: number[]
  value: number
  isDisabled: (m: number) => boolean
  onPick: (m: number) => void
}) {
  return (
    <div role="radiogroup" aria-label={label}>
      <h3 className="mb-1 text-[15px] font-semibold text-fg-soft">{label}</h3>
      <div className="grid grid-cols-2 gap-1.5">
        {times.map((m) => {
          const on = m === value
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={isDisabled(m)}
              onClick={() => onPick(m)}
              className={`min-h-11 rounded-control text-base font-semibold tabular-nums disabled:opacity-35 ${on ? 'bg-accent text-on-accent' : 'ring-[1.5px] ring-line ring-inset'}`}
            >
              {formatMinutes(m)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
