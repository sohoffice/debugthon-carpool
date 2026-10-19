import { STATUS_BAR_HEIGHT, STATUS_BAR_TIME } from './device'

/** `dark` = dark text for light screens, `light` = white text for dark screens. */
export type StatusBarTone = 'dark' | 'light'

/** Simulated phone status bar, drawn over the top of the screen (UD-13). Purely decorative. */
export function StatusBar({ tone }: { tone: StatusBarTone }) {
  const color = tone === 'dark' ? 'text-ink' : 'text-white'
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 z-50 flex items-center justify-between px-8 ${color}`}
      style={{ height: STATUS_BAR_HEIGHT }}
    >
      <span className="text-[16px] font-semibold tabular-nums tracking-wide">{STATUS_BAR_TIME}</span>
      <span className="flex items-center gap-1.5">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke="currentColor" opacity="0.4" />
          <rect x="2" y="2" width="17" height="9" rx="2" fill="currentColor" />
          <rect x="25" y="4.5" width="1.5" height="4" rx="0.75" fill="currentColor" opacity="0.4" />
        </svg>
      </span>
    </div>
  )
}

/** Gesture bar at the bottom of the screen. */
export function HomeIndicator({ tone }: { tone: StatusBarTone }) {
  const color = tone === 'dark' ? 'bg-ink' : 'bg-white'
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-2 z-50 flex justify-center">
      <div className={`h-[5px] w-[134px] rounded-full opacity-80 ${color}`} />
    </div>
  )
}
