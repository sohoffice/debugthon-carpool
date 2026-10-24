import { distanceM, type LatLng } from '@carpool/shared'

/** Never more than this between two reports, so no report jumps over a pickup area (DD-06, radius 80 m). */
export const REPORT_STEP_M = 20
/** Catch-up after a long background pause is capped; the rest follows on the next ticks. */
export const MAX_REPORTS_PER_TICK = 120

export interface SimPath {
  points: LatLng[]
  /** cumulative[i] = metres from points[0] to points[i]. */
  cumulative: number[]
  length: number
}

export function makePath(points: [number, number][]): SimPath {
  const pts = points.map(([lat, lng]) => ({ lat, lng }))
  const cumulative = pts.map(() => 0)
  for (let i = 1; i < pts.length; i++) cumulative[i] = cumulative[i - 1] + distanceM(pts[i - 1], pts[i])
  return { points: pts, cumulative, length: cumulative.at(-1) ?? 0 }
}

/** Metres travelled since `startedAtMs`; position depends on elapsed time, not on how often we ran (DD-14). */
export function distanceTravelled(speedKmh: number, startedAtMs: number, now: number, length: number): number {
  return Math.min(Math.max(now - startedAtMs, 0) / 1000 * (speedKmh / 3.6), length)
}

/** A fast-forward: from `at`, at `speedKmh` until `untilM` metres along the path (T63, T64). */
export interface FastSegment {
  at: number
  speedKmh: number
  untilM: number
}

/**
 * How a car moves along its path (DD-14, T63, T64): parked at the start while `releasedAt` is null,
 * then at `speedKmh`, with each fast-forward in `fast` in order and `speedKmh` between them.
 */
export interface Motion {
  releasedAt: number | null
  speedKmh: number
  fast: FastSegment[]
}

/** Metres along the path at `now`, piecewise by elapsed time, so a throttled tab still catches up (DD-14). */
export function distanceAlong({ releasedAt, speedKmh, fast }: Motion, now: number, length: number): number {
  if (releasedAt === null) return 0
  let at = 0
  let from = releasedAt
  for (const segment of fast) {
    if (now <= segment.at) break
    // At the set speed up to the segment's start; a segment seen before the last one ended follows it.
    const start = Math.max(segment.at, from)
    at = Math.min(at + distanceTravelled(speedKmh, from, start, length), length)
    from = start
    // Already past the stretch when the segment came: nothing to fast-forward.
    if (at >= segment.untilM) continue
    const fastMs = ((segment.untilM - at) / (segment.speedKmh / 3.6)) * 1000
    if (now - from <= fastMs) return Math.min(at + distanceTravelled(segment.speedKmh, from, now, length), length)
    at = segment.untilM
    from += fastMs
  }
  return Math.min(at + distanceTravelled(speedKmh, from, now, length), length)
}

export function pointAt(path: SimPath, along: number): LatLng {
  const d = Math.min(Math.max(along, 0), path.length)
  let i = 1
  while (i < path.points.length - 1 && path.cumulative[i] < d) i++
  const a = path.points[i - 1]
  const b = path.points[i] ?? a
  const segment = path.cumulative[i] - path.cumulative[i - 1]
  const t = segment > 0 ? (d - path.cumulative[i - 1]) / segment : 0
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
}

/**
 * Distances to report when moving from `from` to `to`: every REPORT_STEP_M, then `to` itself.
 * After a throttled background tab the gap can be long; the steps keep the pickup area covered.
 */
export function reportDistances(from: number, to: number): number[] {
  if (to <= from) return []
  const out: number[] = []
  for (let d = from + REPORT_STEP_M; d < to && out.length < MAX_REPORTS_PER_TICK - 1; d += REPORT_STEP_M) out.push(d)
  out.push(out.length === MAX_REPORTS_PER_TICK - 1 ? out[out.length - 1] + REPORT_STEP_M : to)
  return out
}
