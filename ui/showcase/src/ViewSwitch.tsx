import { useRef, type KeyboardEvent } from 'react'

export type View = 'phones' | 'city'

const OPTIONS: { value: View; label: string }[] = [
  { value: 'phones', label: '手機' },
  { value: 'city', label: '市府戰情室' },
]

/** UD-30 part 3: 手機｜市府戰情室, a two-way radio group; arrow keys switch, no transition. */
export function ViewSwitch({ value, onChange }: { value: View; onChange: (view: View) => void }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    // Two options: any arrow goes to the other one.
    const next = OPTIONS.findIndex((o) => o.value !== value)
    onChange(OPTIONS[next].value)
    buttons.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-label="展示頁的畫面" onKeyDown={onKeyDown} className="flex h-9 rounded-[8px] border border-rule bg-paper">
      {OPTIONS.map((option, i) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttons.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`h-full px-4 text-base font-medium first:rounded-l-[7px] last:rounded-r-[7px] ${on ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
