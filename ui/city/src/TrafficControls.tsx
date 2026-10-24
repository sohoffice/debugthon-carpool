import type { CityHistoryDay } from '@carpool/shared'
import { useEffect, useRef } from 'react'
import { slotLabel } from './format'
import { changeDate, DAY_SLOTS, dateOptions, slotsOf, type SlotChoice } from './trafficSlots'
import type { TrafficMode } from './trafficView'

interface TrafficControlsProps {
  today: string
  days: CityHistoryDay[]
  /** The latest slot's start, HH:mm: today's last slot that can be picked (DD-41). */
  latestTime: string
  value: SlotChoice
  onChange: (choice: SlotChoice) => void
  mode: TrafficMode
  onMode: (mode: TrafficMode) => void
}

const MODES: [TrafficMode, string][] = [
  ['level', '路況'],
  ['vs-usual', '比平常'],
]

/**
 * Under the map: the date menu, the 12-slot time line and 路況／比平常 (SC-C1, ui-oi-22). Below 768px
 * the time line is a row of its own that scrolls sideways, the selected slot kept in view (T71).
 */
export function TrafficControls({ today, days, latestTime, value, onChange, mode, onMode }: TrafficControlsProps) {
  const open = slotsOf(value.date, today, latestTime)
  const keys = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = keys.current
    const key = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    // Only the row scrolls, never the page; on desktop every key already fits.
    if (row && key && row.scrollWidth > row.clientWidth) row.scrollLeft = key.offsetLeft - (row.clientWidth - key.offsetWidth) / 2
  }, [value.date, value.time])
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-rule bg-white px-4 max-md:py-2.5 md:h-14 md:flex-nowrap">
      <select
        aria-label="日期"
        className="h-10 rounded-[8px] border border-rule bg-white px-3 text-[15px] font-semibold text-ink max-md:min-w-0 max-md:flex-1"
        value={value.date}
        onChange={(e) => onChange(changeDate(value, e.target.value, today, latestTime))}
      >
        {dateOptions(today, days).map((o) => (
          <option key={o.date} value={o.date}>
            {o.label}
          </option>
        ))}
      </select>
      <div ref={keys} role="group" aria-label="時段" className="order-last flex min-w-0 gap-px max-md:relative max-md:basis-full max-md:overflow-x-auto md:order-none md:flex-1">
        {DAY_SLOTS.map((t) => {
          const can = open.includes(t)
          return (
            <button
              key={t}
              type="button"
              aria-pressed={t === value.time}
              aria-label={slotLabel(t)}
              title={can ? undefined : '還沒到'}
              disabled={!can}
              onClick={() => onChange({ date: value.date, time: t })}
              className={`h-8 min-w-0 rounded-[3px] max-md:w-14 max-md:shrink-0 md:flex-1 text-xs font-semibold tabular-nums ${t === value.time ? 'bg-ink text-white' : can ? 'bg-paper text-ink hover:bg-rule' : 'bg-paper text-fog'}`}
            >
              {t}
            </button>
          )
        })}
      </div>
      <div role="group" aria-label="上色方式" className="flex shrink-0 overflow-hidden rounded-[8px] border border-ink">
        {MODES.map(([m, label]) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)} className={`h-9 px-3.5 text-sm font-semibold ${mode === m ? 'bg-ink text-white' : 'bg-white text-ink'}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
