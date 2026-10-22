import { ErrorNote, Plate, type DriverPoints, type DriverProfile, type PointEntry } from '@carpool/shared'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { account, api } from './config'
import { personName } from './driverName'
import { RoadSign } from './RoadSign'

interface DriverInfo {
  profile: DriverProfile
  points: PointEntry[]
}

const REASONS: Record<PointEntry['reason'], string> = { ride: '共乘完成', seed: '初始點數' }

/** A swipe this far to the left, more sideways than up or down, closes the drawer (SC-D5). */
const SWIPE_CLOSE_PX = 60

const taipei = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** 10/23 08:40 in Taipei time, built from parts so every ICU version spaces it the same. */
function formatTime(iso: string): string {
  const part = Object.fromEntries(taipei.formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
  return `${part.month}/${part.day} ${part.hour}:${part.minute}`
}

/**
 * The driver's own info, an asphalt drawer sliding in from the left (DD-35, REQ-074, UD-24, SC-D5):
 * name, vehicle, point balance and the latest 5 point rows. Reloaded on every open, so a ride just
 * finished shows on top. A failed load keeps the last data. The App closes it whenever a trip runs
 * (DD-04, REQ-066). Closes on the scrim, the × or a swipe to the left.
 */
export function DriverDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [info, setInfo] = useState<DriverInfo | null>(null)
  const [error, setError] = useState(false)
  const swipeStart = useRef<{ x: number; y: number } | null>(null)

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

  function onSwipeEnd(e: PointerEvent) {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    // Only leftwards and mostly sideways: a swipe right or a scroll up and down keeps it open.
    if (dx <= -SWIPE_CLOSE_PX && Math.abs(dx) > Math.abs(dy)) onClose()
  }

  return (
    // Closed, it stays mounted (for the slide and the last data) but is out of reach and out of the a11y tree.
    <div className={`absolute inset-0 z-30 ${open ? '' : 'pointer-events-none'}`} inert={!open} aria-hidden={!open}>
      <button
        type="button"
        aria-label="關閉駕駛資訊"
        tabIndex={-1}
        onClick={onClose}
        className={`absolute inset-0 bg-asphalt-sunk/60 motion-safe:transition-opacity motion-safe:duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* 326px, so 64px of the screen behind stays in sight at 390px wide (SC-D5). 200ms, none with reduced motion (8.4). */}
      <section
        role="dialog"
        aria-label="駕駛資訊"
        onPointerDown={(e) => (swipeStart.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={onSwipeEnd}
        onPointerCancel={() => (swipeStart.current = null)}
        className={`ground-asphalt absolute inset-y-0 left-0 flex w-[326px] max-w-[calc(100%-64px)] touch-pan-y flex-col overflow-y-auto overscroll-contain border-r border-line bg-canvas px-[22px] pt-[calc(var(--safe-top)+16px)] pb-[calc(var(--safe-bottom)+24px)] motion-safe:transition-transform motion-safe:duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <button
          type="button"
          aria-label="關閉"
          onClick={onClose}
          className="absolute top-[calc(var(--safe-top)+10px)] right-3.5 grid size-11 place-items-center rounded-sign-button text-fg-soft"
        >
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="size-[22px]">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {/* The account in small type over the name (SC-D5). */}
        <p className="pr-12 text-[15px] text-fg-soft">駕駛 {account}</p>
        {info && <h2 className="mt-0.5 pr-12 text-[30px]/tight font-semibold break-words">{personName(info.profile.display_name)}</h2>}
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
      {/* The same plate the passenger's confirmed screen shows (UD-24). */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {profile.vehicle ? <Plate plate={profile.vehicle.plate} /> : <span className="text-lg font-semibold">車牌未登記</span>}
        <span className="text-base text-fg-soft">{profile.vehicle?.description ?? '車輛未登記'}</span>
      </div>

      {/* A road sign, and the drawer's only large type (UD-21, UD-24). */}
      <RoadSign className="mt-6 px-[18px] pt-[18px] pb-4">
        <p className="text-[15px] text-fg-soft">累積點數</p>
        <p className="mt-0.5 flex items-baseline gap-1.5">
          <span className="lettering-sign text-[64px]/[0.9] font-extrabold tabular-nums">{profile.point_balance}</span>
          <span className="text-lg text-fg-soft">點</span>
        </p>
      </RoadSign>

      <h3 className="mt-6 mb-1 text-[15px] text-fg-soft">最近的點數</h3>
      {points.length === 0 ? (
        <p className="text-base">還沒有點數紀錄</p>
      ) : (
        <ol aria-label="最近的點數紀錄" className="divide-y divide-line border-b border-line">
          {points.map((p, i) => (
            <li key={`${p.created_at}-${i}`} className="flex min-h-[46px] items-center gap-2.5 text-base">
              <span className="w-[82px] shrink-0 text-[15px] text-fg-soft tabular-nums">{formatTime(p.created_at)}</span>
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
