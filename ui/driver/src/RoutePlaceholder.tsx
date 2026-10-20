interface RoutePlaceholderProps {
  pickupName: string | undefined
  destinationName: string | undefined
}

/**
 * The first departure's empty state in the route strip's language (8.6): pickup ring, a dashed
 * line and the destination square, each saying what is still to choose.
 */
export function RoutePlaceholder({ pickupName, destinationName }: RoutePlaceholderProps) {
  return (
    <ol aria-label="今天的路線" className="relative">
      <li className="flex h-11 items-center gap-4">
        <span className="flex w-5 shrink-0 justify-center">
          <span className={`size-5 rounded-full border-[3.5px] bg-white ${pickupName ? 'border-brand' : 'border-rule'}`} />
        </span>
        <span className={`text-lg ${pickupName ? 'font-semibold' : 'text-ink-soft'}`}>{pickupName ?? '選上車點'}</span>
      </li>
      <li aria-hidden className="flex h-8 w-5 justify-center">
        <span className="h-full border-l-[4px] border-dashed border-rule" />
      </li>
      <li className="flex h-11 items-center gap-4">
        <span className="flex w-5 shrink-0 justify-center">
          <span className={`size-[18px] rounded-[3px] border-[3px] ${destinationName ? 'border-brand bg-brand' : 'border-rule bg-white'}`} />
        </span>
        <span className={`text-lg ${destinationName ? 'font-semibold' : 'text-ink-soft'}`}>{destinationName ?? '選目的地'}</span>
      </li>
    </ol>
  )
}
