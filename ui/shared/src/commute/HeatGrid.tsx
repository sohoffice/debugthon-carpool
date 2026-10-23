import { SimulatedBadge } from '../ui/SimulatedBadge'
import { SLOT_MINUTES, SLOT_STARTS, WINDOW_START, type SlotWindow, type WeatherKind } from './slots'
import { WeatherIcon } from './WeatherIcon'

export type HeatScale = 'ride' | 'road'
export type Ground = 'light' | 'asphalt'

export interface HeatCell {
  /** 0 is a blank cell; 1-6 the scale's steps. */
  level: number
  /** The number written in the cell (rides only, UD-25). */
  text?: string
  /** Read out for the cell, and the traffic detail line (ui-oi-21). */
  label: string
}

export interface HeatRow {
  date: string
  label: string
  /** Today's weekday: the date is bold (UD-25). */
  bold: boolean
  weather: WeatherKind | null
  /** Traffic only: some slot of the day is simulated, so the row is marked (REQ-063, DD-36, SC-X4). */
  simulated?: boolean
  /** One per commute slot; null where the day has no data. */
  cells: (HeatCell | null)[]
}

// Full class names, so Tailwind finds them. Step 0 is a blank cell, a shade off the ground.
const FILL: Record<Ground, Record<HeatScale, string[]>> = {
  light: {
    ride: ['bg-paper', 'bg-ride-1', 'bg-ride-2', 'bg-ride-3', 'bg-ride-4', 'bg-ride-5', 'bg-ride-6'],
    road: ['bg-paper', 'bg-road-1', 'bg-road-2', 'bg-road-3', 'bg-road-4', 'bg-road-5', 'bg-road-6'],
  },
  asphalt: {
    ride: ['bg-asphalt-plate', 'bg-ride-dark-1', 'bg-ride-dark-2', 'bg-ride-dark-3', 'bg-ride-dark-4', 'bg-ride-dark-5', 'bg-ride-dark-6'],
    road: ['bg-asphalt-plate', 'bg-road-dark-1', 'bg-road-dark-2', 'bg-road-dark-3', 'bg-road-dark-4', 'bg-road-dark-5', 'bg-road-dark-6'],
  },
}
const LEGEND_STEPS = [1, 3, 6]
const WORDS: Record<HeatScale, [string, string]> = { ride: ['少', '多'], road: ['順', '塞'] }

interface HeatGridProps {
  title: string
  scale: HeatScale
  ground: Ground
  rows: HeatRow[]
  /** The chosen window, framed the same way on both grids (UD-25). */
  window: SlotWindow
  /** The whole grid is simulated: 「模擬」 on the title row. Traffic marks its rows instead (DD-36). */
  simulated: boolean
  /** 「天氣模擬」 on the title row, apart from the data's own mark (REQ-063, REQ-077, UD-25). */
  weatherSimulated: boolean
  /** Set for the traffic grid: its cells can be tapped (ui-oi-21). */
  selected?: { date: string; slot: number } | null
  onSelect?: (cell: { date: string; slot: number }) => void
}

/**
 * "Date × 15 minutes" heat grid shared by both commute charts (UD-25): 12 columns 07:00-09:45, a
 * row per day newest first with its date, weekday and weather. Rides write their number in the
 * cell and leave 0 blank; traffic is colour only. On light ground the light scale, on asphalt the
 * dark one (8.1): there the lighter step is the larger amount, so the cell text flips too.
 */
export function HeatGrid({ title, scale, ground, rows, window, simulated, weatherSimulated, selected, onSelect }: HeatGridProps) {
  const fill = FILL[ground][scale]
  const fromCol = (window.from - WINDOW_START) / SLOT_MINUTES
  const toCol = (window.to - WINDOW_START) / SLOT_MINUTES
  return (
    <section>
      <div className="mt-5 mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-sm text-fg-soft" aria-label={`顏色越深越${WORDS[scale][1]}`}>
            {WORDS[scale][0]}
            {LEGEND_STEPS.map((step) => (
              <i key={step} className={`inline-block h-2.5 w-3 rounded-[2px] ${fill[step]}`} />
            ))}
            {WORDS[scale][1]}
          </span>
          {simulated && <SimulatedBadge />}
          {weatherSimulated && <SimulatedBadge label="天氣模擬" />}
        </span>
      </div>
      {/* The date column is wide enough for a row's 「模擬」 after the weather icon; both grids share
          this template, so their cells line up (SC-X4, UD-25). */}
      {/* A tap inside the traffic grid never reaches the screen's "tap elsewhere clears" (ui-oi-21). */}
      <div
        role="group"
        aria-label={title}
        onClick={onSelect ? (e) => e.stopPropagation() : undefined}
        className="grid grid-cols-[120px_repeat(12,minmax(0,1fr))] gap-[2px] tabular-nums"
      >
        {SLOT_STARTS.filter((_, i) => i % 2 === 0).map((m, i) => (
          <span key={m} aria-hidden className="text-[11px]/[1.6] text-fg-soft" style={{ gridRow: 1, gridColumn: `${i * 2 + 2} / span 2` }}>
            {`${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`}
          </span>
        ))}
        {rows.map((row, i) => (
          <Row key={row.date} gridRow={i + 2} row={row} scale={scale} fill={fill} selected={selected} onSelect={onSelect} />
        ))}
        {/* One frame over the window's columns, above the cells and never in the way of a tap. Every
            cell is placed by row and column, so the frame overlaps them instead of taking their place. */}
        {rows.length > 0 && toCol > fromCol && (
          <span
            data-testid={`${scale}-window`}
            data-from={fromCol}
            data-to={toCol}
            aria-hidden
            className="pointer-events-none z-20 rounded-[4px] outline-2 outline-offset-1 outline-fg"
            style={{ gridColumn: `${fromCol + 2} / ${toCol + 2}`, gridRow: `2 / span ${rows.length}` }}
          />
        )}
      </div>
    </section>
  )
}

function Row({
  gridRow,
  row,
  scale,
  fill,
  selected,
  onSelect,
}: {
  gridRow: number
  row: HeatRow
  scale: HeatScale
  fill: string[]
  selected: HeatGridProps['selected']
  onSelect: HeatGridProps['onSelect']
}) {
  return (
    <>
      <span className={`flex items-center gap-[3px] text-[11.5px]/[1.1] whitespace-nowrap ${row.bold ? 'font-bold' : ''}`} style={{ gridRow, gridColumn: 1 }}>
        {row.label}
        {row.weather && <WeatherIcon kind={row.weather} className="size-[13px] shrink-0 text-fg-soft" />}
        {row.simulated && <SimulatedBadge size="row" />}
      </span>
      {row.cells.map((cell, slot) => {
        const place = { gridRow, gridColumn: slot + 2 }
        const base = 'grid h-[18px] place-items-center rounded-[3px] text-[10.5px] font-semibold'
        if (!cell) return <span key={slot} className={`${base} border border-line`} style={place} />
        // Light: dark text on the two lightest steps. Asphalt: the reverse (8.1).
        const ink = cell.level >= 3 ? 'text-canvas' : 'text-fg'
        const className = `${base} ${fill[cell.level]} ${ink}`
        if (scale === 'ride' || !onSelect) {
          return (
            <span key={slot} role="img" aria-label={cell.label} className={className} style={place}>
              <span aria-hidden>{cell.text}</span>
            </span>
          )
        }
        const on = selected?.date === row.date && selected.slot === slot
        return (
          <button
            key={slot}
            type="button"
            aria-label={cell.label}
            aria-pressed={on}
            onClick={() => onSelect({ date: row.date, slot })}
            style={place}
            className={`${className} ${on ? 'relative z-10 ring-2 ring-accent ring-offset-1 ring-offset-canvas' : ''}`}
          />
        )
      })}
    </>
  )
}
