import type { CityHistoryDay } from '@carpool/shared'
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

/** Under the map: the date menu, the 12-slot time line and 路況／比平常 (SC-C1, ui-oi-22). */
export function TrafficControls({ today, days, latestTime, value, onChange, mode, onMode }: TrafficControlsProps) {
  const open = slotsOf(value.date, today, latestTime)
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-t border-rule bg-white px-4">
      <select
        aria-label="日期"
        className="h-10 rounded-[8px] border border-rule bg-white px-3 text-[15px] font-semibold text-ink"
        value={value.date}
        onChange={(e) => onChange(changeDate(value, e.target.value, today, latestTime))}
      >
        {dateOptions(today, days).map((o) => (
          <option key={o.date} value={o.date}>
            {o.label}
          </option>
        ))}
      </select>
      <div role="group" aria-label="時段" className="flex min-w-0 flex-1 gap-px">
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
              className={`h-8 min-w-0 flex-1 rounded-[3px] text-xs font-semibold tabular-nums ${t === value.time ? 'bg-ink text-white' : can ? 'bg-paper text-ink hover:bg-rule' : 'bg-paper text-fog'}`}
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
