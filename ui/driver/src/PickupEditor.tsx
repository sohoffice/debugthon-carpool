import type { PickupPoint } from '@carpool/shared'

interface PickupEditorProps {
  pickupPoints: PickupPoint[]
  value: number | null
  onChange: (id: number) => void
}

export function PickupEditor({ pickupPoints, value, onChange }: PickupEditorProps) {
  return (
    <div role="radiogroup" aria-label="上車點" className="flex flex-col">
      {pickupPoints.map((p) => {
        const on = p.id === value
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(p.id)}
            className="flex h-12 items-center gap-3 text-left text-lg"
          >
            <span className={`size-5 rounded-full border-[3.5px] ${on ? 'border-route bg-route' : 'border-line bg-canvas'}`} />
            <span className={on ? 'font-semibold' : ''}>{p.name}</span>
          </button>
        )
      })}
    </div>
  )
}
