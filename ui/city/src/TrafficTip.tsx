interface TrafficTipProps {
  lines: string[]
  at: { x: number; y: number }
}

const OFFSET = 14
const MAX_W = 320

/** The hover box of a line or a cell (SC-C1), kept inside the window. */
export function TrafficTip({ lines, at }: TrafficTipProps) {
  const left = at.x + OFFSET + MAX_W > window.innerWidth ? at.x - OFFSET - MAX_W : at.x + OFFSET
  const top = Math.min(at.y + OFFSET, window.innerHeight - 24 * lines.length - 24)
  return (
    <div role="tooltip" className="pointer-events-none fixed z-50 max-w-80 rounded-[6px] bg-ink px-3 py-2 text-[13px]/snug text-white shadow-lg" style={{ left, top }}>
      {lines.map((l, i) => (
        <p key={i} className={i === 0 ? 'font-semibold' : i === 1 || l.startsWith('代理值') || l.startsWith('這格') ? 'text-asphalt-soft' : ''}>
          {l}
        </p>
      ))}
    </div>
  )
}
