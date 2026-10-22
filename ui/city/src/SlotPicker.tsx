import type { CityHistoryDay } from '@carpool/shared'
import { slotLabel } from './format'
import { changeDate, dateOptions, slotsOf, type SlotChoice } from './trafficSlots'

interface SlotPickerProps {
  today: string
  days: CityHistoryDay[]
  /** The latest slot's start, HH:mm: the default and the last slot of today. */
  latestTime: string
  /** What is shown; the latest slot when nothing is picked. */
  value: SlotChoice
  onChange: (choice: SlotChoice) => void
}

/** Date first, then the slot: two drop-downs under the traffic map (ui-oi-22, SC-C1). */
export function SlotPicker({ today, days, latestTime, value, onChange }: SlotPickerProps) {
  const select = 'h-10 rounded-[8px] border border-rule bg-white px-3 text-base font-medium text-ink'
  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        日期
        <select className={select} value={value.date} onChange={(e) => onChange(changeDate(value, e.target.value, today, latestTime))}>
          {dateOptions(today, days).map((o) => (
            <option key={o.date} value={o.date}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        時段
        <select className={select} value={value.time} onChange={(e) => onChange({ date: value.date, time: e.target.value })}>
          {slotsOf(value.date, today, latestTime).map((t) => (
            <option key={t} value={t}>
              {slotLabel(t)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
