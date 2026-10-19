export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-[52px] shrink-0 rounded-full ${checked ? 'bg-brand' : 'bg-rule'}`}
    >
      <span className={`absolute top-1 left-1 size-6 rounded-full bg-white shadow ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}
