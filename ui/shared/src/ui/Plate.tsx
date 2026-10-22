/** Taiwanese plate look: white plate, dark border and condensed letters, to match the car on the street (UD-09). */
export function Plate({ plate }: { plate: string }) {
  return (
    <span className="inline-flex h-11 shrink-0 items-center rounded-plate border-[3px] border-ink bg-white px-3 text-[28px] text-ink digits-plate">
      {plate}
    </span>
  )
}
