import { ErrorNote, type DriverPoints, type DriverProfile, type PointEntry } from '@carpool/shared'
import { useEffect, useState } from 'react'
import { api } from './config'

interface DriverInfo {
  profile: DriverProfile
  points: PointEntry[]
}

const REASONS: Record<PointEntry['reason'], string> = { ride: '共乘完成', seed: '初始點數' }

const taipei = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** 10/23 08:40 in Taipei time, built from parts so every ICU version spaces it the same. */
function formatTime(iso: string): string {
  const part = Object.fromEntries(taipei.formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
  return `${part.month}/${part.day} ${part.hour}:${part.minute}`
}

/**
 * The driver's own info, sliding in from the side (DD-35, REQ-074): name, vehicle, point balance and
 * the latest 5 point rows. Reloaded on every open, so a ride just finished shows on top. A failed
 * load keeps the last data. The App closes it whenever a trip runs (DD-04, REQ-066).
 */
export function DriverDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [info, setInfo] = useState<DriverInfo | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    let current = true
    // Everything but the point rows comes from the profile, the name included (DD-35).
    Promise.all([api.get<DriverProfile>('/driver/profile'), api.get<DriverPoints>('/driver/points')]).then(
      ([profile, { points }]) => {
        if (!current) return
        setInfo({ profile, points })
        setError(false)
      },
      () => current && setError(true),
    )
    return () => {
      current = false
    }
  }, [open])

  return (
    // Closed, it stays mounted (for the slide and the last data) but is out of reach and out of the a11y tree.
    <div className={`absolute inset-0 z-30 ${open ? '' : 'pointer-events-none'}`} inert={!open} aria-hidden={!open}>
      <button
        type="button"
        aria-label="關閉駕駛資訊"
        tabIndex={-1}
        onClick={onClose}
        className={`absolute inset-0 bg-asphalt/50 motion-safe:transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      <section
        role="dialog"
        aria-label="駕駛資訊"
        className={`ground-light absolute inset-y-0 left-0 flex w-[86%] max-w-[360px] flex-col overflow-y-auto overscroll-contain bg-white px-6 pt-[calc(var(--safe-top)+20px)] pb-[calc(var(--safe-bottom)+24px)] text-ink shadow-xl motion-safe:transition-transform ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-[26px]/tight font-bold break-words">{info?.profile.display_name ?? '駕駛資訊'}</h2>
          <button type="button" onClick={onClose} className="ml-auto h-11 shrink-0 rounded-control px-4 text-lg font-semibold ring-1 ring-inset ring-rule">
            關閉
          </button>
        </div>
        {error && (
          <div className="mt-4">
            <ErrorNote>無法載入駕駛資訊，請稍後再試</ErrorNote>
          </div>
        )}
        {info && <DriverInfoBody info={info} />}
      </section>
    </div>
  )
}

function DriverInfoBody({ info: { profile, points } }: { info: DriverInfo }) {
  return (
    <>
      <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-lg">
        <dt className="text-ink-soft">車牌</dt>
        <dd className="font-semibold">{profile.vehicle?.plate ?? '未登記'}</dd>
        <dt className="text-ink-soft">車輛</dt>
        <dd className="font-semibold">{profile.vehicle?.description ?? '未登記'}</dd>
      </dl>

      <div className="mt-6 rounded-control bg-paper px-5 py-4">
        <p className="text-base text-ink-soft">累積點數</p>
        <p className="text-[40px]/tight font-bold">
          {profile.point_balance} <span className="text-xl font-semibold">點</span>
        </p>
      </div>

      <h3 className="mt-6 text-lg font-semibold">最近的點數紀錄</h3>
      {points.length === 0 ? (
        <p className="mt-2 text-base text-ink-soft">還沒有點數紀錄</p>
      ) : (
        <ol aria-label="最近的點數紀錄" className="mt-2 divide-y divide-rule">
          {points.map((p, i) => (
            <li key={`${p.created_at}-${i}`} className="flex items-baseline gap-3 py-3 text-base">
              <span className="w-[6.5em] shrink-0 text-ink-soft tabular-nums">{formatTime(p.created_at)}</span>
              <span className="flex-1">{REASONS[p.reason]}</span>
              <span className="font-semibold tabular-nums">
                {p.delta > 0 ? '+' : ''}
                {p.delta}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
