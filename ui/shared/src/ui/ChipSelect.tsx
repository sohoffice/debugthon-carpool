export interface ChipOption {
  id: number
  label: string
}

interface ChipSelectProps {
  label: string
  options: ChipOption[]
  selected: number[]
  onToggle: (id: number) => void
}

/** Multi-select chips: my tags, acceptable drop-off bus stops (8.3). */
export function ChipSelect({ label, options, selected, onToggle }: ChipSelectProps) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id)
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.id)}
            className={`min-h-11 rounded-full px-4 text-base font-medium ${on ? 'bg-brand text-white' : 'bg-white text-ink ring-1 ring-inset ring-rule active:bg-paper'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
