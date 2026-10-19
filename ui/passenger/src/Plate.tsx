/** Taiwanese plate look: white plate, dark border and condensed letters, to match the car on the street (UD-09). */
export function Plate({ plate }: { plate: string }) {
  return (
    <span className="inline-flex h-11 shrink-0 items-center rounded-[6px] border-[3px] border-ink bg-white px-3 font-board text-[28px] font-semibold tracking-wider text-ink tabular-nums">
      {plate}
    </span>
  )
}
