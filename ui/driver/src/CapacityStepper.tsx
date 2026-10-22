import { CAPACITY_RANGE } from './config'

const STEP_CLASS = 'flex size-11 items-center justify-center rounded-full text-2xl font-semibold ring-[1.5px] ring-inset ring-line active:bg-sunk disabled:text-line'

export function CapacityStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="flex items-center gap-3">
      <button type="button" aria-label="減少可載人數" className={STEP_CLASS} disabled={value <= CAPACITY_RANGE.min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output aria-label="可載人數" className="w-6 text-center text-2xl font-semibold tabular-nums">
        {value}
      </output>
      <button type="button" aria-label="增加可載人數" className={STEP_CLASS} disabled={value >= CAPACITY_RANGE.max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  )
}
