/** Station name plate: a full-width line-colour band, a white bar and large white type, no corners (UD-01, UD-21). */
export function StationSign({ name, note }: { name: string; note?: string }) {
  return (
    <div className="flex h-[72px] items-center bg-brand pr-6 text-white">
      <span aria-hidden className="ml-6 w-3.5 self-stretch bg-white" />
      <span className="ml-4 min-w-0 truncate text-[32px] font-semibold">{name}</span>
      {note && <span className="ml-auto shrink-0 pl-3 text-base font-semibold">{note}</span>}
    </div>
  )
}
