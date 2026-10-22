/** Which mode the driver is in, after three lane dashes in the line colour (UD-21). */
export function ModeLabel({ children }: { children: string }) {
  return (
    <p className="flex items-center gap-3 text-xl font-semibold text-fg-soft">
      <span aria-hidden className="flex gap-[5px]">
        <span className="h-1.5 w-4 bg-route" />
        <span className="h-1.5 w-4 bg-route" />
        <span className="h-1.5 w-4 bg-route" />
      </span>
      {children}
    </p>
  )
}
