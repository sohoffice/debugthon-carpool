export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      // 44px high to tap (the touch target guideline), the track inside stays 32px.
      className="relative flex h-11 w-[52px] shrink-0 items-center"
    >
      <span className={`h-8 w-full rounded-full ${checked ? 'bg-brand' : 'bg-rule'}`} />
      <span className={`absolute top-2.5 left-1 size-6 rounded-full bg-white shadow ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}
