import { AdvancedMarker } from '@vis.gl/react-google-maps'
import type { LatLng } from './config'

/**
 * pickup = station sign, stop = small ring, dropoff = filled circle, destination = square: the route
 * strip's symbols (8.6). pickup-option = another pickup point that could be chosen, a quiet sign.
 */
export type PlaceKind = 'pickup' | 'pickup-option' | 'stop' | 'dropoff' | 'destination'

interface PlaceMarkerProps {
  position: LatLng
  kind: PlaceKind
  title?: string
}

function Symbol({ kind, title }: { kind: PlaceKind; title?: string }) {
  if (kind === 'pickup') {
    return (
      <span className="flex h-8 items-center overflow-hidden rounded-[6px] bg-brand pr-2.5 text-base font-bold whitespace-nowrap text-white shadow-md shadow-ink/30">
        <span className="mr-2 h-full w-1.5 bg-white/90" />
        {title}
      </span>
    )
  }
  if (kind === 'pickup-option') {
    return (
      <span className="flex h-7 items-center overflow-hidden rounded-[6px] bg-white pr-2 text-sm font-bold whitespace-nowrap text-brand shadow-md shadow-ink/20 ring-2 ring-brand ring-inset">
        <span className="mr-1.5 h-full w-1.5 bg-brand" />
        {title}
      </span>
    )
  }
  if (kind === 'stop') return <span className="block size-3 rounded-full border-[2.5px] border-brand bg-white" />
  if (kind === 'dropoff') return <span className="block size-5 rounded-full border-[3.5px] border-white bg-brand shadow" />
  return <span className="block size-[18px] rounded-[3px] border-2 border-white bg-brand shadow" />
}

/** Places drawn with the same symbols as the route strip instead of Google's pins. */
export function PlaceMarker({ position, kind, title }: PlaceMarkerProps) {
  return (
    // The sign stands on its point; the round and square symbols sit centred on it.
    <AdvancedMarker position={position} title={title} zIndex={kind === 'stop' ? 1 : 2} anchorTop={kind === 'pickup' || kind === 'pickup-option' ? '-100%' : '-50%'}>
      <Symbol kind={kind} title={title} />
    </AdvancedMarker>
  )
}
