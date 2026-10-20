/** Station name plate: a route-colour band with large white type (UD-01). */
export function StationSign({ name, note }: { name: string; note?: string }) {
  return (
    <div className="flex h-16 items-center bg-brand pr-6 text-white">
      <span aria-hidden className="h-full w-3 bg-white/90" />
      <span className="ml-4 min-w-0 truncate text-3xl font-bold">{name}</span>
      {note && <span className="ml-auto shrink-0 pl-3 text-base font-semibold">{note}</span>}
    </div>
  )
}
