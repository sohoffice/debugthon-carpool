import { AdvancedMarker, Pin } from '@vis.gl/react-google-maps'
import type { LatLng } from './config'

export type PlaceKind = 'pickup' | 'stop' | 'destination' | 'vehicle'

const PIN_STYLE: Record<PlaceKind, { background: string; glyphText: string; scale: number }> = {
  pickup: { background: '#0f766e', glyphText: '上', scale: 1.2 },
  stop: { background: '#6b7280', glyphText: '', scale: 0.7 },
  destination: { background: '#b91c1c', glyphText: '終', scale: 1.1 },
  vehicle: { background: '#1d4ed8', glyphText: '車', scale: 1 },
}

interface PlaceMarkerProps {
  position: LatLng
  kind: PlaceKind
  title?: string
  onClick?: () => void
}

export function PlaceMarker({ position, kind, title, onClick }: PlaceMarkerProps) {
  const style = PIN_STYLE[kind]
  return (
    <AdvancedMarker position={position} title={title} onClick={onClick}>
      <Pin background={style.background} borderColor="#ffffff" glyphColor="#ffffff" glyphText={style.glyphText} scale={style.scale} />
    </AdvancedMarker>
  )
}
